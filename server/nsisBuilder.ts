import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const CACHE_DIR = '/tmp/coursehub_installers';

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create cache dir:', err);
  }
}

const BUILD_VERSION = 'v6.2.1';

export function buildNsisInstaller(clientAppUrl: string): Buffer {
  const hash = crypto.createHash('md5').update(clientAppUrl + BUILD_VERSION).digest('hex');
  const cachedExePath = path.join(CACHE_DIR, `CourseHub-VIP-Setup-${hash}.exe`);

  if (fs.existsSync(cachedExePath)) {
    try {
      return fs.readFileSync(cachedExePath);
    } catch (e) {
      console.warn('Cache read error, regenerating:', e);
    }
  }

  const workDir = path.join('/tmp', `nsis_build_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const iconPath = path.join(process.cwd(), 'public', 'app_icon.ico');
    const hasIcon = fs.existsSync(iconPath);

    // 1. Compile Native GUI Launcher Executable (CourseHubVIP.exe)
    // Runs without cmd/console window, handles isolated profile storage
    const launcherNsi = `
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

OutFile "${workDir}/CourseHubVIP.exe"
${hasIcon ? `Icon "${iconPath}"` : ''}

Section
  Var /GLOBAL AppUrl
  Var /GLOBAL DataDir
  Var /GLOBAL BrowserExe
  
  StrCpy $AppUrl "${clientAppUrl}"
  StrCpy $DataDir "$LOCALAPPDATA\\CourseHub-VIP\\ProfileData"
  CreateDirectory "$DataDir"
  
  ; Check Edge
  IfFileExists "$PROGRAMFILES(x86)\\Microsoft\\Edge\\Application\\msedge.exe" 0 +3
    StrCpy $BrowserExe '"$PROGRAMFILES(x86)\\Microsoft\\Edge\\Application\\msedge.exe"'
    Goto Launch
  IfFileExists "$PROGRAMFILES\\Microsoft\\Edge\\Application\\msedge.exe" 0 +3
    StrCpy $BrowserExe '"$PROGRAMFILES\\Microsoft\\Edge\\Application\\msedge.exe"'
    Goto Launch
    
  ; Check Chrome
  IfFileExists "$PROGRAMFILES(x86)\\Google\\Chrome\\Application\\chrome.exe" 0 +3
    StrCpy $BrowserExe '"$PROGRAMFILES(x86)\\Google\\Chrome\\Application\\chrome.exe"'
    Goto Launch
  IfFileExists "$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe" 0 +3
    StrCpy $BrowserExe '"$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe"'
    Goto Launch
    
  ; Fallback default browser
  ExecShell "open" "$AppUrl"
  Quit

Launch:
  Exec '$BrowserExe --app="$AppUrl" --user-data-dir="$DataDir" --window-size=1280,820 --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2,msHubSidebar,SearchInWeb --hide-crash-restore-bubble'
  Quit
SectionEnd
`;
    fs.writeFileSync(path.join(workDir, 'launcher.nsi'), launcherNsi, 'utf8');
    execSync(`makensis "${path.join(workDir, 'launcher.nsi')}"`, { stdio: 'pipe' });

    // 2. Compile Full Windows Setup Wizard (CourseHub-VIP-Setup-v6.2.0.exe)
    // Includes: Welcome -> Directory Selection -> Installation Progress -> Windows App Registry -> Finish Screen
    const setupNsi = `
!include "MUI2.nsh"

; General Configuration
Name "CourseHub VIP Desktop"
OutFile "${workDir}/CourseHub-VIP-Setup-v6.2.0.exe"
InstallDir "$LOCALAPPDATA\\Programs\\CourseHub VIP"
InstallDirRegKey HKCU "Software\\CourseHubVIP" "Install_Dir"
RequestExecutionLevel user

; GUI Configuration (Modern UI 2)
!define MUI_ABORTWARNING
${hasIcon ? `!define MUI_ICON "${iconPath}"` : ''}
${hasIcon ? `!define MUI_UNICON "${iconPath}"` : ''}

; Setup Wizard Pages
!define MUI_WELCOMEPAGE_TITLE "Bienvenido al Asistente de Instalación de CourseHub VIP"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instalará CourseHub VIP Desktop v6.2.0 en su ordenador.\\r\\n\\r\\nEl software le permitirá acceder a sus cursos protegidos con aislamiento físico de cookies y perfiles en el disco duro de su PC.\\r\\n\\r\\nHaga clic en Siguiente para continuar."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "El programa de instalación instalará CourseHub VIP en la siguiente carpeta. Para instalar o descomprimir los archivos en una carpeta diferente, haga clic en Examinar y seleccione otra carpeta."
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

; Finish Page
!define MUI_FINISHPAGE_TITLE "Instalación de CourseHub VIP Completada"
!define MUI_FINISHPAGE_TEXT "CourseHub VIP Desktop se ha instalado correctamente en su equipo.\\r\\n\\r\\nSe han creado los accesos directos en su Escritorio y en el Menú Inicio de Windows."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\CourseHubVIP.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Ejecutar CourseHub VIP ahora"
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "Spanish"

; Installation Section
Section "CourseHub VIP (Requerido)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  
  ; Extract Application Files
  File "${workDir}/CourseHubVIP.exe"
  ${hasIcon ? `File "${iconPath}"` : ''}
  
  ; Configuration metadata
  FileOpen $0 "$INSTDIR\\app_config.json" w
  FileWrite $0 '{"appName":"CourseHub VIP Desktop","version":"6.2.0","url":"${clientAppUrl}","installedAt":"2026-09-08"}'
  FileClose $0
  
  ; Write README / Info
  FileOpen $1 "$INSTDIR\\LEEME.txt" w
  FileWrite $1 "CourseHub VIP Desktop v6.2.0\\r\\nAplicación oficial de escritorio con aislamiento de sesiones en disco duro.\\r\\nAcceso Directo: $INSTDIR\\CourseHubVIP.exe\\r\\nDesinstalador: $INSTDIR\\uninstall.exe"
  FileClose $1
  
  ; Store installation folder in Registry
  WriteRegStr HKCU "Software\\CourseHubVIP" "Install_Dir" "$INSTDIR"
  
  ; Register in Windows "Add or Remove Programs" (Programas y Características)
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "DisplayName" "CourseHub VIP Desktop"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "DisplayVersion" "6.2.0"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "Publisher" "CourseHub VIP"
  ${hasIcon ? `WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "DisplayIcon" "$INSTDIR\\app_icon.ico"` : `WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "DisplayIcon" "$INSTDIR\\CourseHubVIP.exe"`}
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "UninstallString" '"$INSTDIR\\uninstall.exe"'
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "NoRepair" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP" "EstimatedSize" 3072
  
  ; Create Uninstaller executable
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  
  ; Create Desktop Shortcut
  ${hasIcon ? `CreateShortCut "$DESKTOP\\CourseHub VIP.lnk" "$INSTDIR\\CourseHubVIP.exe" "" "$INSTDIR\\app_icon.ico" 0` : `CreateShortCut "$DESKTOP\\CourseHub VIP.lnk" "$INSTDIR\\CourseHubVIP.exe"`}
  
  ; Create Start Menu Folder & Shortcuts
  CreateDirectory "$SMPROGRAMS\\CourseHub VIP"
  ${hasIcon ? `CreateShortCut "$SMPROGRAMS\\CourseHub VIP\\CourseHub VIP.lnk" "$INSTDIR\\CourseHubVIP.exe" "" "$INSTDIR\\app_icon.ico" 0` : `CreateShortCut "$SMPROGRAMS\\CourseHub VIP\\CourseHub VIP.lnk" "$INSTDIR\\CourseHubVIP.exe"`}
  CreateShortCut "$SMPROGRAMS\\CourseHub VIP\\Desinstalar CourseHub VIP.lnk" "$INSTDIR\\uninstall.exe" "" "$INSTDIR\\uninstall.exe" 0
SectionEnd

; Uninstallation Section
Section "Uninstall"
  ; Remove Registry keys
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CourseHubVIP"
  DeleteRegKey HKCU "Software\\CourseHubVIP"

  ; Remove Desktop and Start Menu shortcuts
  Delete "$DESKTOP\\CourseHub VIP.lnk"
  Delete "$SMPROGRAMS\\CourseHub VIP\\CourseHub VIP.lnk"
  Delete "$SMPROGRAMS\\CourseHub VIP\\Desinstalar CourseHub VIP.lnk"
  RMDir "$SMPROGRAMS\\CourseHub VIP"

  ; Remove Application files
  Delete "$INSTDIR\\CourseHubVIP.exe"
  Delete "$INSTDIR\\app_icon.ico"
  Delete "$INSTDIR\\app_config.json"
  Delete "$INSTDIR\\LEEME.txt"
  Delete "$INSTDIR\\uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
`;

    fs.writeFileSync(path.join(workDir, 'setup.nsi'), setupNsi, 'utf8');
    execSync(`makensis "${path.join(workDir, 'setup.nsi')}"`, { stdio: 'pipe' });

    const finalExePath = path.join(workDir, 'CourseHub-VIP-Setup-v6.2.0.exe');
    const exeBuffer = fs.readFileSync(finalExePath);

    // Save to cache
    try {
      fs.writeFileSync(cachedExePath, exeBuffer);
    } catch (e) {
      console.warn('Failed to cache installer:', e);
    }

    return exeBuffer;
  } catch (error) {
    console.error('NSIS compilation failed:', error);
    throw error;
  } finally {
    // Cleanup temporary build files
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}
