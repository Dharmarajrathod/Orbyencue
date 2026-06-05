# ISSUES FOUND

## Build and Dependency Issues

- `pyaudiowpatch` could not be installed from the original manifest on macOS and was unconditionally imported at module import time.
- `requirements.txt` omitted required packages: Pillow, requests, pypdf/PDF parser, python-docx, and python-pptx.
- Dependency versions were unpinned, making builds non-reproducible.
- Python 3.9 produced compatibility and support warnings for Google client libraries.
- `PyPDF2` was deprecated.
- Vulnerability audit found vulnerable dependency pins in Pillow, python-dotenv, requests, urllib3, and the first pypdf replacement version.

## Runtime Issues

- `gui.py` and `license.py` assumed `APPDATA` always existed, which broke imports outside Windows.
- `rag_engine.py` and `file_processor.py` raised immediately when `OPENAI_API_KEY` was absent, preventing imports, tests, and partial UI startup.
- `listener.py` initialized Windows audio hardware during GUI construction, causing startup failure on unsupported hosts or missing VB-Audio Virtual Cable.
- Google Speech credentials were hardcoded to a specific JSON filename.
- Cosine similarity could divide by zero for malformed or empty vectors.
- License backend errors were not consistently converted into safe invalid responses.

## Code Quality Issues

- License logic was duplicated in `gui.py` and `license.py`.
- Tracked `__pycache__` bytecode files polluted the repository.
- `transcriber.py` duplicated listener behavior and was unused.
- Dead GUI methods referenced `self.canvas` and `self.card_id`, which were never created.
- Ruff reported ambiguous variable names and an unused local variable.

## Packaging and Configuration Issues

- PyInstaller spec bundled `.env` and a Google service-account JSON, creating secret exposure risk.
- PyInstaller executable name did not match the Inno Setup installer expectation.
- No `.gitignore`, `.env.example`, pytest config, or declared supported Python version existed.

## Testing Gaps

- No automated tests existed.
- No import-safety tests existed for operation without secrets.
- No tests covered license cache handling, chunking, normalization, CSV extraction, or vector edge cases.

## Remaining Environment Risks

- End-to-end runtime validation requires Windows, Tk support, VB-Audio Virtual Cable, valid OpenAI credentials, valid Google Speech credentials, and a reachable license backend.
- The local Python 3.10 interpreter used for validation does not include `_tkinter`, so GUI import was skipped in that environment. Python 3.9 on this machine has Tk but is no longer the supported runtime.
