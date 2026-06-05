# FIXES APPLIED

## Configuration and Runtime Safety

- Added `config.py` for shared resource paths, environment loading, Google credential resolution, and cross-platform config directory handling.
- Centralized license operations in `license.py`.
- Changed OpenAI clients in `file_processor.py` and `rag_engine.py` to lazy initialization.
- Added safe network error handling for license verification.
- Made Windows audio capture fail with a clear runtime message instead of failing import/startup.
- Made Google Speech credentials configurable through `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials.
- Added zero-vector protection in cosine similarity.

## Dependency and Security Fixes

- Rebuilt `requirements.txt` with pinned dependencies.
- Marked `PyAudioWPatch` as Windows-only.
- Replaced deprecated `PyPDF2` with `pypdf`.
- Updated vulnerable pins: Pillow, python-dotenv, requests, urllib3, and pypdf.
- Declared Python 3.10+ in `pyproject.toml`.

## Code Quality Fixes

- Removed duplicate license code from `gui.py`.
- Removed unused `transcriber.py`.
- Removed dead GUI canvas methods.
- Fixed ruff lint issues.
- Removed tracked `__pycache__` files.
- Added `.gitignore` for virtualenvs, caches, local secrets, and build outputs.

## Packaging Fixes

- Removed `.env` and service-account JSON bundling from `Orbynecue.spec`.
- Updated the PyInstaller executable name to `ORBYNECUE`.
- Kept the Inno Setup installer aligned to the generated executable name.

## Tests Added

- License path, cache, expiry, and backend failure tests.
- Text normalization, chunking, CSV extraction, and OpenAI-key failure tests.
- RAG zero-vector and empty-document tests.
- Import-safety tests for core modules, with GUI import skipped when the interpreter lacks Tk.

## Verification Results

- Dependency install: passed under Python 3.10.
- Source compile: passed.
- Ruff lint: passed.
- Pytest: 11 passed, 1 skipped.
- pip check: passed.
- pip-audit: no known vulnerabilities found.
- PyInstaller build: passed under Python 3.10 on macOS with a local Tk warning because this interpreter lacks `_tkinter`.
