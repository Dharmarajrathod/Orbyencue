import os
import re
import shutil
import subprocess
import time
import tempfile
import json
from urllib import error, request
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from config import load_environment
except ImportError:
    load_environment = None


if load_environment:
    load_environment()


DEFAULT_GEMINI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]
DEFAULT_OLLAMA_MODEL = "llama3.2"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"


class AnswerRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=20000)


class AnswerResponse(BaseModel):
    answer: str
    model: str


class KnowledgeResponse(BaseModel):
    chunks: list[str]
    chunkCount: int
    filename: str


class TranscriptResponse(BaseModel):
    transcript: str
    model: str


class GeminiQuotaError(RuntimeError):
    def __init__(self, retry_after: int | None = None):
        self.retry_after = retry_after
        message = "Gemini quota is exhausted."
        if retry_after:
            message += f" Retry after about {retry_after} seconds."
        message += " Wait for quota reset or enable billing/increase quota in Google AI Studio."
        super().__init__(message)


app = FastAPI(title="ORBYNECUE AI Backend")
gemini_client = None
BASE_DIR = Path(__file__).resolve().parent
SUPPORTED_UPLOAD_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".pdf", ".doc", ".docx", ".ppt", ".pptx"}


def get_allowed_origins():
    configured = os.getenv("ALLOWED_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["*"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")


def get_models():
    configured = os.getenv("GEMINI_MODELS") or os.getenv("GEMINI_MODEL")
    if configured:
        return [model.strip() for model in configured.split(",") if model.strip()]
    return DEFAULT_GEMINI_MODELS


def get_ai_provider():
    configured = os.getenv("AI_PROVIDER", "").strip().lower()
    if configured in {"ollama", "gemini"}:
        return configured
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    return "ollama"


def get_ollama_base_url():
    return os.getenv("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL).rstrip("/")


def get_ollama_model():
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL).strip() or DEFAULT_OLLAMA_MODEL


def get_gemini_client():
    global gemini_client
    if gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured on the server.")

        from google import genai

        gemini_client = genai.Client(api_key=api_key)
    return gemini_client


def is_quota_error(message: str) -> bool:
    return "429" in message or "RESOURCE_EXHAUSTED" in message or "quota" in message.lower()


def extract_retry_after(message: str) -> int | None:
    patterns = [
        r"retry in ([0-9.]+)s",
        r"'retryDelay': '([0-9]+)s'",
        r'"retryDelay": "([0-9]+)s"',
    ]
    for pattern in patterns:
        match = re.search(pattern, message, re.IGNORECASE)
        if match:
            return max(1, int(float(match.group(1))))
    return None


def stream_chunks(text: str, max_words: int = 220):
    paragraphs = [paragraph.strip() for paragraph in text.splitlines() if paragraph.strip()]
    buffer = []
    word_count = 0

    for paragraph in paragraphs:
        words = paragraph.split()
        if not words:
            continue
        if word_count + len(words) > max_words and buffer:
            yield "\n".join(buffer)
            buffer = []
            word_count = 0
        buffer.append(paragraph)
        word_count += len(words)

    if buffer:
        yield "\n".join(buffer)


def normalize_text(text: str) -> str:
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def extract_upload_text(path: Path, extension: str) -> str:
    if extension in {".txt", ".md", ".json"}:
        return path.read_text(encoding="utf-8", errors="ignore")

    if extension == ".csv":
        import csv

        rows = []
        with path.open(newline="", encoding="utf-8", errors="ignore") as file_obj:
            for row in csv.reader(file_obj):
                rows.append(" ".join(cell for cell in row if cell))
        return "\n".join(rows)

    if extension == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    if extension == ".docx":
        from docx import Document

        document = Document(str(path))
        parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
        for table in document.tables:
            for row in table.rows:
                parts.append(" ".join(cell.text.strip() for cell in row.cells if cell.text.strip()))
        return "\n".join(parts)

    if extension == ".doc":
        return extract_legacy_office_text(path, extension)

    if extension == ".pptx":
        from pptx import Presentation

        presentation = Presentation(str(path))
        parts = []
        for slide in presentation.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    parts.append(shape.text)
        return "\n".join(parts)

    if extension == ".ppt":
        return extract_legacy_office_text(path, extension)

    raise ValueError(f"Unsupported file type: {extension}")


def extract_legacy_office_text(path: Path, extension: str) -> str:
    if extension == ".doc" and shutil.which("textutil"):
        result = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout

    if extension == ".doc" and shutil.which("antiword"):
        result = subprocess.run(
            ["antiword", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout

    if extension == ".ppt" and shutil.which("catppt"):
        result = subprocess.run(
            ["catppt", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout

    raise ValueError(
        f"Old {extension} files need a system converter. Please save the file as "
        f"{'.docx' if extension == '.doc' else '.pptx'} and upload again."
    )


def build_prompt(question: str) -> str:
    return f"""
You are an interview assistant.

STRICT OUTPUT RULES (MANDATORY):
- The answer MUST contain exactly one numbered item.
- Keep the content point-wise inside that one item.
- Follow this EXACT format:

1. **Complete Answer**:
- first concise point
- second concise point

IMPORTANT:
- Headings MUST be wrapped in ** ** (markdown bold).
- Do NOT add a second numbered item.
- Use document or meeting context when it is supplied in the question.
- Do NOT add extra text before or after the list.

Question:
{question}

Answer:
"""


def generate_answer(question: str):
    if get_ai_provider() == "ollama":
        return generate_ollama_answer(question)
    return generate_gemini_answer(question)


def generate_gemini_answer(question: str):
    errors = []
    quota_retry_after = None
    prompt = build_prompt(question)

    for model in get_models():
        for attempt in range(3):
            try:
                response = get_gemini_client().models.generate_content(
                    model=model,
                    contents=prompt,
                )
                return response.text.strip(), f"gemini/{model}"
            except Exception as exc:
                message = str(exc)
                errors.append(f"{model}: {message}")
                if is_quota_error(message):
                    retry_after = extract_retry_after(message)
                    if retry_after is not None:
                        quota_retry_after = retry_after if quota_retry_after is None else min(quota_retry_after, retry_after)
                    break
                if "503" not in message and "UNAVAILABLE" not in message:
                    break
                time.sleep(0.75 * (attempt + 1))

    if quota_retry_after is not None or any(is_quota_error(error) for error in errors):
        raise GeminiQuotaError(quota_retry_after)

    raise RuntimeError("Gemini fallback failed. " + " | ".join(errors[-3:]))


def generate_ollama_answer(question: str):
    prompt = build_prompt(question)
    model = get_ollama_model()
    url = f"{get_ollama_base_url()}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }

    try:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Ollama request failed with HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(
            f"Ollama is not reachable at {get_ollama_base_url()}. "
            f"Start Ollama and run `ollama pull {model}`."
        ) from exc

    answer = (data.get("response") or "").strip()
    if not answer:
        raise RuntimeError("Ollama returned an empty answer.")
    return answer, f"ollama/{model}"


def transcribe_audio(audio_bytes: bytes, mime_type: str, language: str = "auto"):
    if get_ai_provider() == "ollama":
        raise RuntimeError(
            "Meeting audio transcription still needs Gemini or another speech-to-text engine. "
            "Use browser speech recognition/manual questions, or set AI_PROVIDER=gemini for this endpoint."
        )

    errors = []
    quota_retry_after = None
    language_hint = "Detect and transcribe every spoken language naturally."
    if language and language != "auto":
        language_hint = f"The primary spoken language is {language}; still keep any other spoken language if it appears."
    prompt = (
        "Transcribe the spoken words in this audio. "
        f"{language_hint} "
        "Return only the transcript text. If there is no clear speech, return an empty string."
    )

    from google.genai import types

    for model in get_models():
        for attempt in range(3):
            try:
                response = get_gemini_client().models.generate_content(
                    model=model,
                    contents=[
                        prompt,
                        types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                    ],
                )
                return (response.text or "").strip(), f"gemini/{model}"
            except Exception as exc:
                message = str(exc)
                errors.append(f"{model}: {message}")
                if is_quota_error(message):
                    retry_after = extract_retry_after(message)
                    if retry_after is not None:
                        quota_retry_after = retry_after if quota_retry_after is None else min(quota_retry_after, retry_after)
                    break
                if "503" not in message and "UNAVAILABLE" not in message:
                    break
                time.sleep(0.75 * (attempt + 1))

    if quota_retry_after is not None or any(is_quota_error(error) for error in errors):
        raise GeminiQuotaError(quota_retry_after)

    raise RuntimeError("Gemini transcription failed. " + " | ".join(errors[-3:]))


@app.get("/health")
def health():
    provider = get_ai_provider()
    return {
        "status": "ok",
        "provider": provider,
        "geminiConfigured": bool(os.getenv("GEMINI_API_KEY")),
        "ollamaConfigured": provider == "ollama",
        "ollamaBaseUrl": get_ollama_base_url(),
        "ollamaModel": get_ollama_model(),
        "models": get_models(),
    }


@app.get("/")
def website():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/icon.png")
def icon():
    return FileResponse(BASE_DIR / "icon.png")


@app.get("/logo.png")
def logo():
    return FileResponse(BASE_DIR / "logo.png")


@app.post("/answer", response_model=AnswerResponse)
def answer(request: AnswerRequest):
    try:
        answer_text, model = generate_answer(request.question.strip())
        return AnswerResponse(answer=answer_text, model=model)
    except GeminiQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/knowledge", response_model=KnowledgeResponse)
async def upload_knowledge(file: UploadFile = File(...)):
    filename = file.filename or "knowledge"
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_UPLOAD_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_UPLOAD_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Supported: {supported}")

    suffix = extension or ".txt"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = Path(temp_file.name)
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)

        text = normalize_text(extract_upload_text(temp_path, extension))
        if not text:
            raise HTTPException(status_code=400, detail="No readable text found in this file.")

        chunks = list(stream_chunks(text))
        return KnowledgeResponse(chunks=chunks, chunkCount=len(chunks), filename=filename)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"File processing error: {exc}") from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


@app.post("/transcribe-audio", response_model=TranscriptResponse)
async def transcribe_meeting_audio(file: UploadFile = File(...), language: str = Form("auto")):
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio chunk.")

    mime_type = file.content_type or "audio/webm"
    try:
        transcript, model = transcribe_audio(audio_bytes, mime_type, language)
        return TranscriptResponse(transcript=transcript, model=model)
    except GeminiQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import threading
    import webbrowser

    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    url = f"http://127.0.0.1:{port}"
    print(f"ORBYNECUE web app: {url}")
    if os.getenv("ORBYNE_OPEN_BROWSER", "true").lower() != "false":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port)
