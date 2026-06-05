# -*- mode: python ; coding: utf-8 -*-

import sys

block_cipher = None

hiddenimports = [
    'google.cloud.speech',
    'google.oauth2.service_account',
    'google.genai',
    'openai',
    'vosk',
    'PIL',
    'PIL._tkinter_finder',
    'dotenv',
    'numpy',
    'pypdf',
    'docx',
    'pptx',
    'requests',
    'tkinter',
    'threading',
    'queue',
    'csv',
    'json',
    'datetime',
    'pathlib',
    'config',
]

if sys.platform == 'win32':
    hiddenimports.append('pyaudiowpatch')
else:
    hiddenimports.append('sounddevice')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('icon.png', '.'),
        ('logo.png', '.'),
        ('orbynecue.ico', '.'),
        ('models/vosk-model-small-en-us-0.15', 'models/vosk-model-small-en-us-0.15'),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ORBYNECUE',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Set to True if you want to see console for debugging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='orbynecue.ico',
    version_file=None,
)
