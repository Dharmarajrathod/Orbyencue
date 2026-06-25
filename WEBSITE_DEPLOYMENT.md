# Website Deployment

ORBYNECUE includes a backend-served website. The AI provider runs in Python, not in the browser.

## What Runs Where

- `app.py` serves the website from `index.html` and `assets/`.
- `app.py` also exposes `/answer`, which can call Ollama or Gemini.
- The browser never asks for or stores provider API keys.

## Run Locally

With Ollama:

```bash
cd /Users/dharmarajrathod/Documents/ovy
ollama pull llama3.2
export AI_PROVIDER=ollama
export OLLAMA_MODEL=llama3.2
/opt/homebrew/bin/python3.10 app.py
```

Then open:

```text
http://127.0.0.1:8000
```

## Publish Online

GitHub Pages can publish the static website, but it cannot run the Python backend. On GitHub Pages, backend features such as document upload and meeting transcription need a reachable backend URL.

For local testing with Ollama, run:

```bash
cd /Users/dharmarajrathod/Documents/ovy
export AI_PROVIDER=ollama
export OLLAMA_MODEL=llama3.2
/opt/homebrew/bin/python3.10 app.py
```

Then open `http://127.0.0.1:8000`.

For a fully public app, deploy this repository as a Render `Web Service` or point the frontend at another reachable backend.

Use:

- Build Command: `pip install -r backend-requirements.txt`
- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Environment variables for hosted meeting transcription: `NVIDIA_API_KEY`, `NVIDIA_ASR_MODEL=nvidia/parakeet-ctc-1.1b-asr`, `NVIDIA_ASR_FUNCTION_ID=1598d209-5e27-4d3c-8079-4751568b1081`, and `ORBYNE_MEETING_STT_PROVIDER=nvidia`

After deploy, open the Render URL. The website will work directly because the backend has the provider configuration.

To use the GitHub Pages URL with a deployed backend, open the dashboard, click `Settings`, and save the backend URL, for example:

```text
https://your-render-service.onrender.com
```

For Ollama hosting, the deployed backend must be able to reach an Ollama server through `OLLAMA_BASE_URL`. A Render service cannot call Ollama running on your laptop at `127.0.0.1`.

To hard-code a hosted backend for the static site, set `window.ORBYNE_PUBLIC_BACKEND_URL` or `window.ORBYNE_API_BASE_URL` before `assets/app.js` loads. The Settings dialog stores the same value in `orbynecue.apiBaseUrl` in browser local storage.

## Browser Notes

- Speech recognition works best in Chrome or Edge.
- The website can listen to microphone audio allowed by the browser.
- To capture meeting audio, click `Share audio`, choose the meeting tab or screen, and enable the browser's audio sharing option.
- In Chrome, Google Meet audio capture usually works best by choosing the `Chrome Tab` option and selecting the Meet tab with `Share tab audio` enabled.
- The Meeting Audio meter should move and say `Audio detected`. If it says `No audio detected`, stop sharing and share the Meet tab again with tab audio enabled.
- Meeting Audio uses NVIDIA for transcription when `ORBYNE_MEETING_STT_PROVIDER=nvidia`, so it consumes NVIDIA API quota. The app records short segments and only auto-answers likely questions to reduce usage.
- When `AI_PROVIDER=ollama`, manual questions and browser speech recognition work, but meeting audio transcription needs a separate speech-to-text engine.
- If you see `Gemini quota is exhausted`, wait for the retry/reset window or enable billing/increase quota in Google AI Studio.
- Browser websites cannot directly capture another app's system audio unless the user shares a tab/screen or uses OS-level audio routing.
- Knowledge uploads support `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.csv`, and `.json`.
- Old `.doc` and `.ppt` files are attempted with system converters. If they fail, save them as `.docx` or `.pptx` and upload again.
