# Windows EXE Build

You must build the `.exe` on Windows. PyInstaller cannot cross-compile a Windows `.exe` from macOS.

## Steps

1. Install Python 3.10 for Windows from python.org.
2. Install VB-Audio Virtual Cable if you need meeting/system audio capture.
3. Copy this repository folder to Windows.
4. Make sure the Vosk model exists:

   `models\vosk-model-small-en-us-0.15`

5. Open Command Prompt in the project folder.
6. Run:

   ```bat
   build_windows.bat
   ```

7. Send this file to the Windows user:

   `dist\ORBYNECUE.exe`

## Optional Gemini Fallback

If the Windows user wants Gemini answers for questions below the document match threshold, set:

```bat
set GEMINI_API_KEY=your_key
```

Then run `ORBYNECUE.exe` from that same terminal, or add the variable in Windows Environment Variables.
