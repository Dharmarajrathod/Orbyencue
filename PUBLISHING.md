# Publishing ORBYNECUE

This project can publish separate builds for Windows and macOS.

## What Users Download

- Windows: `ORBYNECUE-windows.zip`, containing `ORBYNECUE.exe`
- macOS: `ORBYNECUE-macos.zip`, containing the macOS executable

## Automated GitHub Builds

The workflow in `.github/workflows/release-builds.yml` builds both platforms.

### Manual Build

1. Push the repository to GitHub.
2. Open the repository on GitHub.
3. Go to `Actions`.
4. Select `Release builds`.
5. Click `Run workflow`.
6. Download artifacts from the completed run.

### Release Build

Create and push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build both artifacts and attach them to a GitHub Release.

## Required Runtime Setup

The app includes free local Vosk speech recognition. Users do not need Google Speech billing.

For Gemini fallback answers, users need a Gemini API key:

```text
GEMINI_API_KEY=your_key
```

Without a Gemini key, document answers still work when the document match is 50% or higher.

## Windows Audio Notes

For system/meeting audio capture on Windows, install VB-Audio Virtual Cable and route meeting audio to it.

## macOS Audio Notes

For meeting/system audio capture on macOS, use BlackHole or a similar loopback device. Without loopback, the app listens to the default microphone.

## Signing and Trust

Unsigned apps may trigger Windows SmartScreen or macOS Gatekeeper warnings.

For production distribution:

- Windows: buy a code-signing certificate and sign `ORBYNECUE.exe`.
- macOS: join the Apple Developer Program, sign, notarize, and staple the macOS build.
