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

GitHub Pages can publish the static website, but it cannot run the Python backend.

The GitHub Pages version automatically tries to use this local backend while you test:

```text
http://127.0.0.1:8000
```

So before using the GitHub Pages URL with Ollama, run:

```bash
cd /Users/dharmarajrathod/Documents/ovy
export AI_PROVIDER=ollama
export OLLAMA_MODEL=llama3.2
/opt/homebrew/bin/python3.10 app.py
```

For a fully public app, deploy this repository as a Render `Web Service` or point the frontend at another reachable backend.

Use:

- Build Command: `pip install -r backend-requirements.txt`
- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Environment variables for Gemini hosting: `AI_PROVIDER=gemini` and `GEMINI_API_KEY`

After deploy, open the Render URL. The website will work directly because the backend has the provider configuration.

For Ollama hosting, the deployed backend must be able to reach an Ollama server through `OLLAMA_BASE_URL`. A Render service cannot call Ollama running on your laptop at `127.0.0.1`.

To use a custom hosted backend from the static site, set `window.ORBYNE_API_BASE_URL` before `assets/app.js` loads, or save `orbynecue.apiBaseUrl` in browser local storage.

## Browser Notes

- Speech recognition works best in Chrome or Edge.
- The website can listen to microphone audio allowed by the browser.
- To capture meeting audio, click `Share audio`, choose the meeting tab or screen, and enable the browser's audio sharing option.
- In Chrome, Google Meet audio capture usually works best by choosing the `Chrome Tab` option and selecting the Meet tab with `Share tab audio` enabled.
- The Meeting Audio meter should move and say `Audio detected`. If it says `No audio detected`, stop sharing and share the Meet tab again with tab audio enabled.
- Meeting Audio uses Gemini for transcription when `AI_PROVIDER=gemini`, so it consumes quota. The app records 20-second segments and only auto-answers likely questions to reduce usage.
- When `AI_PROVIDER=ollama`, manual questions and browser speech recognition work, but meeting audio transcription needs a separate speech-to-text engine.
- If you see `Gemini quota is exhausted`, wait for the retry/reset window or enable billing/increase quota in Google AI Studio.
- Browser websites cannot directly capture another app's system audio unless the user shares a tab/screen or uses OS-level audio routing.
- Knowledge uploads support `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.csv`, and `.json`.
- Old `.doc` and `.ppt` files are attempted with system converters. If they fail, save them as `.docx` or `.pptx` and upload again.
