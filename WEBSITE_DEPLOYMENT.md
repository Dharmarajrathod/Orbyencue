# Website Deployment

ORBYNECUE now includes a backend-served website. The Gemini API key stays in Python/Render, not in the browser.

## What Runs Where

- `app.py` serves the website from `index.html` and `assets/`.
- `app.py` also exposes `/answer`, which calls Gemini with `GEMINI_API_KEY`.
- The browser never asks for or stores the Gemini API key.

## Run Locally

```bash
cd /Users/dharmarajrathod/Documents/ovy
export GEMINI_API_KEY="your-gemini-api-key"
/opt/homebrew/bin/python3.10 app.py
```

Then open:

```text
http://127.0.0.1:8000
```

## Publish Online

Deploy this repository as a Render `Web Service`.

Use:

- Build Command: `pip install -r backend-requirements.txt`
- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Environment variable: `GEMINI_API_KEY`

After deploy, open the Render URL. The website will work directly because the backend already has the key.

## Browser Notes

- Speech recognition works best in Chrome or Edge.
- The website can listen to microphone audio allowed by the browser.
- To capture meeting audio, click `Share audio`, choose the meeting tab or screen, and enable the browser's audio sharing option.
- In Chrome, Google Meet audio capture usually works best by choosing the `Chrome Tab` option and selecting the Meet tab with `Share tab audio` enabled.
- Browser websites cannot directly capture another app's system audio unless the user shares a tab/screen or uses OS-level audio routing.
- Knowledge uploads support `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.csv`, and `.json`.
- Old `.doc` and `.ppt` files are attempted with system converters. If they fail, save them as `.docx` or `.pptx` and upload again.
