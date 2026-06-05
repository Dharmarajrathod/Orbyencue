# RUNBOOK

## Common Commands

```bash
python -m pip install -r requirements.txt
python -m ruff check .
python -m pytest -q
python -m pip_audit -r requirements.txt
python -m pip check
pyinstaller --clean --noconfirm Orbynecue.spec
```

## Troubleshooting

### Application asks for license every launch

- Check the OS config directory is writable.
- Confirm the backend returns `valid: true` and an `expires_on` value.
- Confirm system time is correct.

### `OPENAI_API_KEY is required`

- Create `.env` next to the source or executable.
- Set `OPENAI_API_KEY`.
- Restart the app.

### Google Speech authentication fails

- Set `GOOGLE_APPLICATION_CREDENTIALS` to a valid service-account JSON path.
- Confirm Speech-to-Text is enabled in Google Cloud.
- Confirm outbound network access to Google APIs.

### Listening cannot start on Windows

- Confirm the app is running on Windows.
- Install VB-Audio Virtual Cable.
- Ensure an input device name contains `cable output`.
- Install dependencies from `requirements.txt` on Windows so `PyAudioWPatch` is installed.

### Listening cannot start on macOS/Linux

- Install dependencies from `requirements.txt` so `sounddevice` is installed.
- Allow microphone permission when macOS prompts.
- Set `ORBYNE_AUDIO_DEVICE` to a device index or name if the default input is wrong.

### GUI import fails with `_tkinter`

- Install or use a Python build with Tk support.
- On Windows official Python installers include Tk by default.

## Incident Notes

- The app stores embeddings only in memory; restart clears indexed documents.
- Secrets should remain external to packaged artifacts.
- If OpenAI or Google APIs are unavailable, transcription/answer generation will not function.

## Maintenance

- Run `pip-audit` before every release.
- Prefer Python 3.11+ before October 4, 2026 because Google client libraries warn that Python 3.10 support will end then.
- Keep the Windows packaging path validated after PyInstaller or Inno Setup upgrades.
