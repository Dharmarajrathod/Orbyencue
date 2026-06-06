import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
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


class AnswerRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


class AnswerResponse(BaseModel):
    answer: str
    model: str


app = FastAPI(title="ORBYNECUE Gemini Backend")
gemini_client = None
BASE_DIR = Path(__file__).resolve().parent


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


def get_gemini_client():
    global gemini_client
    if gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured on the server.")

        from google import genai

        gemini_client = genai.Client(api_key=api_key)
    return gemini_client


def build_prompt(question: str) -> str:
    return f"""
You are an interview assistant.

STRICT OUTPUT RULES (MANDATORY):
- The answer MUST be a numbered list.
- Each point MUST follow this EXACT format:

1. **2-3 word heading**: explanation in 1-2 concise sentences.
2. **2-3 word heading**: explanation in 1-2 concise sentences.
3. **2-3 word heading**: explanation in 1-2 concise sentences.

IMPORTANT:
- Headings MUST be wrapped in ** ** (markdown bold).
- Keep the heading and explanation on the SAME LINE.
- Do NOT add blank lines between points.
- Do NOT use bullet points.
- Do NOT add extra text before or after the list.

Question:
{question}

Answer:
"""


def generate_answer(question: str):
    errors = []
    prompt = build_prompt(question)

    for model in get_models():
        for attempt in range(3):
            try:
                response = get_gemini_client().models.generate_content(
                    model=model,
                    contents=prompt,
                )
                return response.text.strip(), model
            except Exception as exc:
                message = str(exc)
                errors.append(f"{model}: {message}")
                if "503" not in message and "UNAVAILABLE" not in message:
                    break
                time.sleep(0.75 * (attempt + 1))

    raise RuntimeError("Gemini fallback failed. " + " | ".join(errors[-3:]))


@app.get("/health")
def health():
    return {
        "status": "ok",
        "geminiConfigured": bool(os.getenv("GEMINI_API_KEY")),
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
