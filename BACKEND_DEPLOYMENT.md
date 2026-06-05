# Gemini Backend Deployment

This backend keeps your Gemini API key on Render so desktop users do not need to set a key.

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
   - `ORBYNECUE_BACKEND_TOKEN`: any long random password/token you choose

8. Optional environment variable:

   - `GEMINI_MODELS`: `gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash`
   - `ALLOWED_ORIGINS`: your GitHub Pages URL, or `*` while testing

9. Click `Deploy Web Service`.

## Desktop App Setup

After Render deploys, copy the Render URL and set:

```bash
export GEMINI_BACKEND_URL="https://your-render-service.onrender.com"
export ORBYNECUE_BACKEND_TOKEN="same-token-you-set-on-render"
```

For packaged apps, set this environment variable on the user's machine or build it into a config file.

## Test Backend

```bash
curl https://your-render-service.onrender.com/health
```

Expected:

```json
{"status":"ok"}
```
