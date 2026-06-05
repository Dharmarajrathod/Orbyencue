# rag_engine.py - Hybrid document retrieval + Gemini fallback (PyInstaller-safe)

import os
import re
import time
import numpy as np
import requests
from openai import OpenAI

from config import load_environment
from file_processor import DOCUMENT_CHUNKS, DOCUMENT_EMBEDDINGS

# ======================================================
# Load .env correctly (works in EXE + normal Python)
# ======================================================
load_environment()
client = None
gemini_client = None

TOP_K = 4
DOCUMENT_MATCH_THRESHOLD = 50.0
MAX_LOCAL_ANSWER_WORDS = 180
DEFAULT_GEMINI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]
GEMINI_MODELS = [
    model.strip()
    for model in os.getenv("GEMINI_MODELS", os.getenv("GEMINI_MODEL", ",".join(DEFAULT_GEMINI_MODELS))).split(",")
    if model.strip()
]


def get_openai_client():
    global client
    if client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required to generate answers.")
        client = OpenAI(api_key=api_key)
    return client


def get_gemini_client():
    global gemini_client
    if gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is required to generate Gemini fallback answers.")

        from google import genai

        gemini_client = genai.Client(api_key=api_key)
    return gemini_client


def cosine_similarity(a, b):
    denominator = np.linalg.norm(a) * np.linalg.norm(b)
    if denominator == 0:
        return 0.0
    return float(np.dot(a, b) / denominator)


def tokenize(text: str):
    return [word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2]


def lexical_similarity(question: str, chunk: str):
    question_words = set(tokenize(question))
    if not question_words:
        return 0.0

    chunk_words = set(tokenize(chunk))
    overlap = question_words.intersection(chunk_words)
    return len(overlap) / len(question_words)


def sentence_matches(question: str, context: str, limit=3):
    question_words = set(tokenize(question))
    sentences = re.split(r"(?<=[.!?])\s+", context)
    ranked = []

    for sentence in sentences:
        clean_sentence = sentence.strip()
        if not clean_sentence:
            continue
        hits = len(question_words.intersection(tokenize(clean_sentence)))
        if hits:
            ranked.append((hits, clean_sentence))

    ranked.sort(reverse=True, key=lambda item: item[0])
    return [sentence for _, sentence in ranked[:limit]]


def compact_text(text: str, max_words=MAX_LOCAL_ANSWER_WORDS):
    words = text.split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(" .,;:") + "..."


def extract_answer_section(question: str, chunk: str):
    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    if not lines:
        return compact_text(chunk)

    question_words = set(tokenize(question))
    best_index = 0
    best_score = -1

    for index, line in enumerate(lines):
        score = len(question_words.intersection(tokenize(line)))
        if score > best_score:
            best_score = score
            best_index = index

    collected = [lines[best_index]]
    for line in lines[best_index + 1:]:
        lower_line = line.lower()
        if re.match(r"^(q(uestion)?\s*\d*[:.)-]?|[0-9]+\.)\s+", line, re.IGNORECASE):
            break
        if lower_line.endswith("?") and len(tokenize(line)) <= 14:
            break
        collected.append(line)
        if len(" ".join(collected).split()) >= MAX_LOCAL_ANSWER_WORDS:
            break

    return compact_text(" ".join(collected))


def local_answer_from_context(question: str, scored_chunks):
    points = []
    for _, chunk in scored_chunks[:TOP_K]:
        section = extract_answer_section(question, chunk)
        if section and section not in points:
            points.append(section)
        if len(points) >= 3:
            break

    lines = []
    for index, point in enumerate(points[:3], start=1):
        lines.append(f"{index}. **Complete Answer**: {point}")

    return "\n".join(lines)


def answer_from_local_document(question: str):
    scores = [(lexical_similarity(question, chunk), chunk) for chunk in DOCUMENT_CHUNKS]
    scores.sort(reverse=True, key=lambda item: item[0])

    if not scores:
        return None, 0.0

    confidence = round(scores[0][0] * 100, 2)
    if confidence < DOCUMENT_MATCH_THRESHOLD:
        return None, confidence

    return local_answer_from_context(question, scores), confidence


def answer_from_document(question: str):
    """Document-grounded answer with confidence"""

    if not DOCUMENT_CHUNKS:
        return None, 0.0

    if len(DOCUMENT_EMBEDDINGS) != len(DOCUMENT_CHUNKS):
        return answer_from_local_document(question)

    try:
        q_emb = get_openai_client().embeddings.create(
            model="text-embedding-3-small",
            input=question
        ).data[0].embedding
    except Exception:
        return answer_from_local_document(question)

    q_emb = np.array(q_emb)

    scores = []
    for chunk, emb in zip(DOCUMENT_CHUNKS, DOCUMENT_EMBEDDINGS):
        score = cosine_similarity(q_emb, emb)
        scores.append((score, chunk))

    scores.sort(reverse=True, key=lambda x: x[0])

    best_score = scores[0][0]
    confidence = round(best_score * 100, 2)
    if confidence < DOCUMENT_MATCH_THRESHOLD:
        return None, confidence

    context = "\n\n".join(chunk for _, chunk in scores[:TOP_K])

    prompt = f"""
You are an interview assistant.

STRICT OUTPUT RULES (MANDATORY):
- The answer MUST be structured as a numbered list.
- Each point MUST follow this exact format:

1. **2-3 word heading**: explanation in exactly two short lines.
2. **2–3 word heading**: explanation in exactly two short lines.
3. **2–3 word heading**: explanation in exactly two short lines.

- Headings MUST be bold.
- Headings MUST be only 2-3 words (no more).
- Each explanation MUST be exactly two lines (concise, factual).
- Do NOT use bullet points.
- Do NOT write paragraphs.
- Do NOT add extra text before or after the list.
- Do NOT repeat the answers.
- Do NOT add conclusions or summaries.
- Cover ALL relevant points from the context.

Context:
{context}

Question:
{question}

Answer:
"""



    try:
        response = get_openai_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )
    except Exception:
        return local_answer_from_context(question, scores), confidence

    answer = response.choices[0].message.content.strip()
    return answer, confidence


def answer_from_gemini(question: str):
    """General Gemini fallback (no document restriction)"""
    backend_url = os.getenv("GEMINI_BACKEND_URL")
    if backend_url:
        headers = {}
        backend_token = os.getenv("ORBYNECUE_BACKEND_TOKEN")
        if backend_token:
            headers["Authorization"] = f"Bearer {backend_token}"

        response = requests.post(
            backend_url.rstrip("/") + "/answer",
            json={"question": question},
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()["answer"].strip()

    prompt = f"""
You are an interview assistant.

STRICT OUTPUT RULES (MANDATORY):
- The answer MUST be a numbered list.
- Each point MUST follow this EXACT format:

1. **2–3 word heading**: explanation in 1–2 concise sentences.
2. **2–3 word heading**: explanation in 1–2 concise sentences.
3. **2–3 word heading**: explanation in 1–2 concise sentences.

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



    errors = []
    for model in GEMINI_MODELS:
        for attempt in range(3):
            try:
                response = get_gemini_client().models.generate_content(
                    model=model,
                    contents=prompt,
                )
                return response.text.strip()
            except Exception as exc:
                message = str(exc)
                errors.append(f"{model}: {message}")
                if "503" not in message and "UNAVAILABLE" not in message:
                    break
                time.sleep(0.75 * (attempt + 1))

    raise RuntimeError("Gemini fallback failed. " + " | ".join(errors[-3:]))


def answer_from_openai(question: str):
    """Backward-compatible alias for the Gemini fallback."""
    return answer_from_gemini(question)
