# Gemini Backend Deployment

This backend keeps your Gemini API key on Render and serves the ORBYNECUE website directly.

## Render Setup

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

   - `GEMINI_API_KEY`: your Gemini key

8. Optional environment variable:

   - `GEMINI_MODELS`: `gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash`
   - `ALLOWED_ORIGINS`: your GitHub Pages URL, or `*` while testing

9. Click `Deploy Web Service`.

## Local App Setup

Run the backend-served website locally:

```bash
cd /Users/dharmarajrathod/Documents/ovy
export GEMINI_API_KEY="your-gemini-api-key"
/opt/homebrew/bin/python3.10 app.py
```

Then open `http://127.0.0.1:8000`.

## Test Backend

```bash
curl https://your-render-service.onrender.com/health
```

Expected:

```json
{"status":"ok"}
```
