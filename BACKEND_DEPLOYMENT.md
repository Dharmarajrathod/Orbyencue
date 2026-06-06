# Backend Deployment

This backend serves the ORBYNECUE website directly and can use either Ollama or Gemini for answers.

## Local Ollama Setup

Install and start Ollama, then pull a model:

```bash
ollama pull llama3.2
```

Run the backend-served website locally:

```bash
cd /Users/dharmarajrathod/Documents/ovy
export AI_PROVIDER=ollama
export OLLAMA_MODEL=llama3.2
export OLLAMA_BASE_URL=http://127.0.0.1:11434
/opt/homebrew/bin/python3.10 app.py
```

Then open `http://127.0.0.1:8000`.

To use another local model, pull it first and change `OLLAMA_MODEL`, for example:

```bash
ollama pull mistral
export OLLAMA_MODEL=mistral
```

## Render Setup

Ollama is intended for local machines. A normal Render web service will not have your laptop's Ollama server. For public hosting, either:

- keep using Gemini with a server-side `GEMINI_API_KEY`, or
- host Ollama on your own machine/VPS/GPU server and set `OLLAMA_BASE_URL` to that server.

If using Gemini on Render:

1. Go to Render.
2. Click `+ New`.
3. Click `Web Service`.
4. Connect your GitHub repository.
5. Select this repo.
6. Use these settings:

   - Runtime: `Python`
   - Build Command: `pip install -r backend-requirements.txt`
   - Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`

7. Add environment variables:

   - `AI_PROVIDER`: `gemini`
   - `GEMINI_API_KEY`: your Gemini key

8. Optional environment variable:

   - `GEMINI_MODELS`: `gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash`
   - `ALLOWED_ORIGINS`: your GitHub Pages URL, or `*` while testing

9. Click `Deploy Web Service`.

## Gemini Local Setup

If you want to use Gemini locally instead of Ollama:

```bash
cd /Users/dharmarajrathod/Documents/ovy
export AI_PROVIDER=gemini
export GEMINI_API_KEY="your-gemini-api-key"
/opt/homebrew/bin/python3.10 app.py
```

## Test Backend

```bash
curl https://your-render-service.onrender.com/health
```

Expected:

```json
{"status":"ok"}
```

## Supported Knowledge Files

- PDF: `.pdf`
- Word: `.docx`
- PowerPoint: `.pptx`
- Text data: `.txt`, `.md`, `.csv`, `.json`

Old `.doc` and `.ppt` files are attempted with system converters. For best reliability, save old Office files as `.docx` or `.pptx`.

## Meeting Audio Capture

The website includes a `Share audio` button. It asks the browser for tab/screen audio, sends short audio chunks to `/transcribe-audio`, and uses Gemini to transcribe them.

For Google Meet in Chrome, choose `Chrome Tab`, select the Meet tab, and enable `Share tab audio`.

Meeting audio transcription uses Gemini quota. If the backend returns HTTP 429, wait for quota reset or enable billing/increase quota in Google AI Studio.

When `AI_PROVIDER=ollama`, meeting audio transcription is disabled unless you add a separate speech-to-text engine. Browser speech recognition and manual questions still work.
