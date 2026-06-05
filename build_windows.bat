@echo off
setlocal

cd /d "%~dp0"

if not exist models\vosk-model-small-en-us-0.15 (
  echo Missing Vosk model: models\vosk-model-small-en-us-0.15
  echo Download https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
  echo and unzip it into the models folder before building.
  exit /b 1
)

py -3.10 -m venv .venv-win
call .venv-win\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
pyinstaller --clean --noconfirm Orbynecue.spec

echo.
echo Build finished. EXE should be here:
echo dist\ORBYNECUE.exe
