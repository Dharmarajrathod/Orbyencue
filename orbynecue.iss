[Setup]
AppName=ORBYNECUE
AppVersion=1.0.0
AppPublisher=Orbyne Labs
AppPublisherURL=https://cvolvepro.com
DefaultDirName={pf}\ORBYNECUE
DefaultGroupName=ORBYNECUE
UninstallDisplayIcon={app}\ORBYNECUE.exe
OutputBaseFilename=ORBYNECUE-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile=orbynecue.ico
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
DisableProgramGroupPage=yes

[Files]
Source: "dist\ORBYNECUE.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\ORBYNECUE"; Filename: "{app}\ORBYNECUE.exe"
Name: "{commondesktop}\ORBYNECUE"; Filename: "{app}\ORBYNECUE.exe"

[Run]
Filename: "{app}\ORBYNECUE.exe"; Description: "Launch ORBYNECUE"; Flags: nowait postinstall skipifsilent
