# ARCHITECTURE

## Runtime Flow

1. `main.py` creates a Tk root and initializes `InterviewHelperGUI`.
2. `gui.py` verifies the local cached license or prompts for a license key.
3. The user uploads a PDF, DOCX, PPTX, or CSV file.
4. `file_processor.py` extracts and normalizes text, chunks content, and stores OpenAI embeddings in memory.
5. When listening starts, `listener.py` captures Windows system audio from VB-Audio Virtual Cable.
6. `streaming_transcriber.py` sends audio chunks to Google Speech-to-Text and returns final transcripts.
7. `rag_engine.py` embeds the transcript, retrieves similar document chunks, and generates a structured answer. If document confidence is too low, it calls OpenAI directly.
8. `gui.py` renders the answer in the Tkinter text area.

## State Model

- License state is cached as JSON under the OS config directory.
- Knowledge chunks and embeddings are process-local in-memory lists.
- Audio and transcription state is controlled by a `threading.Event`.
- No database is used.

## Configuration

Configuration is supplied by environment variables or `.env`:

- `OPENAI_API_KEY`: required for file processing and answer generation.
- `GOOGLE_APPLICATION_CREDENTIALS`: optional explicit path to a Google service-account JSON file.
- `ORBYNE_LICENSE_BACKEND_URL`: optional license verification endpoint override.

## Security Boundaries

- Secrets are not bundled into the PyInstaller artifact.
- `.env` and `google-credentials.json` are ignored by git.
- License backend failures return an invalid-license response instead of raising raw network exceptions.
- External file parsing is limited to supported file types.

## Deployment Target

The functional deployment target is Windows with Python 3.10+, VB-Audio Virtual Cable, Google Cloud credentials, OpenAI credentials, and outbound network access to Google, OpenAI, and the license backend.
