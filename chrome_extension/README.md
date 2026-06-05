# ORBYNECUE Chrome Extension

This is a browser-native prototype of the ORBYNECUE assistant.

## What Works

- Opens as a Chrome side panel.
- Uploads `.txt`, `.md`, `.csv`, and `.json` knowledge files.
- Stores uploaded text chunks in `chrome.storage.local`.
- Uses Chrome Speech Recognition for microphone transcription.
- Searches uploaded knowledge locally and shows a concise answer.

## Current Limits

- It does not run the Python desktop code.
- It captures microphone speech, not internal tab/system audio.
- It does not call OpenAI or Google Cloud from the browser because production API keys should not be shipped inside an extension.
- PDF, DOCX, and PPTX parsing need either browser parser libraries or a backend conversion API.

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder:

   `/Users/dharmarajrathod/Documents/ovy/New_Rep_ITool/chrome_extension`

6. Click the ORBYNECUE extension icon to open the side panel.

## Production Path

For a production-grade extension, add a small backend service that:

- Stores OpenAI and Google credentials securely.
- Accepts uploaded files and extracts text from PDF/DOCX/PPTX.
- Performs embeddings and retrieval.
- Streams transcription or accepts browser-captured text.
- Enforces license authentication server-side.
