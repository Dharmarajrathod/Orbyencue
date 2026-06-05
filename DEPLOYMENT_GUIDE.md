# DEPLOYMENT GUIDE

## Requirements

- Windows 10/11 for system-audio capture, or macOS/Linux for microphone capture.
- Python 3.10+.
- VB-Audio Virtual Cable installed and configured on Windows.
- OpenAI API key.
- Google Cloud project with Speech-to-Text enabled.
- Google Application Default Credentials or a service-account JSON file.
- Inno Setup for Windows installer generation.

## Local Setup

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Create `.env` from `.env.example`:

```text
OPENAI_API_KEY=your_openai_key
GOOGLE_APPLICATION_CREDENTIALS=C:\secure\path\google-credentials.json
ORBYNE_LICENSE_BACKEND_URL=https://cvolvepro.com/orbyneai/api/verify-license
```

Do not commit `.env` or credential JSON files.

## Run From Source

```bash
python main.py
```

## Build Executable

```bash
pyinstaller --clean --noconfirm Orbynecue.spec
```

Expected Windows output:

```text
dist\ORBYNECUE.exe
```

## Build Installer

After the executable exists, compile `orbynecue.iss` with Inno Setup.

Expected installer output:

```text
ORBYNECUE-Setup.exe
```

## Validation Checklist

- License prompt accepts a valid key and caches the result.
- Uploading PDF, DOCX, PPTX, and CSV files indexes chunks.
- Start Listening finds VB-Audio Virtual Cable on Windows or the default microphone on macOS/Linux.
- Google Speech returns final transcripts.
- Document-grounded answers appear when uploaded content matches the question.
- OpenAI fallback answers appear when document confidence is too low.
