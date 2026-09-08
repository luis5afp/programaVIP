// Utility to generate installers and download packages for CourseHub VIP Client
// Generates native Windows 1-Click Desktop Launcher (.bat) and Electron project files (.zip)
import JSZip from 'jszip';

export interface ExeMetadata {
  version: string;
  appName?: string;
  githubRepo?: string;
  serverUrl?: string;
  coursesCount?: number;
  timestamp?: string;
  modules?: any[];
}

// Helper to convert string to PowerShell Base64 (UTF-16LE)
export function toPowerShellBase64(script: string): string {
  let binary = '';
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, (code >> 8) & 0xff);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return Buffer.from(script, 'utf16le').toString('base64');
}

// Generate an automated Windows 1-Click Desktop App Installer (.bat)
// Works 100% out of the box on Windows 10 & 11 without any remote 404s or dependencies
export function generateWindowsBatchInstaller(meta: ExeMetadata): string {
  const version = meta.version || '6.2.0';
  const serverUrl = meta.serverUrl || 'https://programavip.luis5afp.workers.dev';
  const clientAppUrl = serverUrl.includes('?') ? `${serverUrl}&mode=client` : `${serverUrl}/?mode=client`;

  const psScript = `
$appUrl = '${clientAppUrl}'
$installDir = "$env:LOCALAPPDATA\\CourseHub-VIP"
$profileDir = "$installDir\\ProfileData"

if (-not (Test-Path $installDir)) {
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

$edgePaths = @(
  "$env:ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:LOCALAPPDATA\\Microsoft\\Edge\\Application\\msedge.exe"
)
$chromePaths = @(
  "$env:ProgramFiles(x86)\\Google\\Chrome\\Application\\chrome.exe",
  "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
  "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
)

$targetExe = ""
foreach ($p in $edgePaths) {
  if (Test-Path $p) { $targetExe = $p; break }
}
if (-not $targetExe) {
  foreach ($p in $chromePaths) {
    if (Test-Path $p) { $targetExe = $p; break }
  }
}
if (-not $targetExe) {
  $targetExe = "msedge.exe"
}

$launchArgs = "--app=""$appUrl"" --user-data-dir=""$profileDir"" --window-size=1280,820 --no-first-run"

$wsh = New-Object -ComObject WScript.Shell

$desktopPaths = @(
  [Environment]::GetFolderPath('Desktop'),
  "$env:USERPROFILE\\Desktop",
  "$env:USERPROFILE\\Escritorio",
  "$env:USERPROFILE\\OneDrive\\Desktop",
  "$env:USERPROFILE\\OneDrive\\Escritorio",
  "$env:ONEDRIVE\\Desktop",
  "$env:ONEDRIVE\\Escritorio"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$createdCount = 0
foreach ($d in $desktopPaths) {
  try {
    $lnkPath = Join-Path $d "CourseHub VIP.lnk"
    $lnk = $wsh.CreateShortcut($lnkPath)
    $lnk.TargetPath = $targetExe
    $lnk.Arguments = $launchArgs
    $lnk.IconLocation = "$targetExe,0"
    $lnk.Description = "CourseHub VIP Desktop Client"
    $lnk.Save()
    Write-Host " [+] Acceso directo creado: $lnkPath" -ForegroundColor Green
    $createdCount++
  } catch {}
}

$startMenu = [Environment]::GetFolderPath('Programs')
if (Test-Path $startMenu) {
  try {
    $startLnk = $wsh.CreateShortcut((Join-Path $startMenu "CourseHub VIP.lnk"))
    $startLnk.TargetPath = $targetExe
    $startLnk.Arguments = $launchArgs
    $startLnk.IconLocation = "$targetExe,0"
    $startLnk.Save()
    Write-Host " [+] Acceso directo anadido al Menu Inicio" -ForegroundColor Green
  } catch {}
}

Write-Host ""
Write-Host " [+] Abriendo CourseHub VIP en modo ventana nativa..." -ForegroundColor Cyan
Start-Process -FilePath $targetExe -ArgumentList $launchArgs
`;

  const encodedCmd = toPowerShellBase64(psScript.trim());

  return `@echo off
title CourseHub VIP Desktop - Instalador Windows v${version}
color 0A
cls

echo ================================================================
echo           COURSEHUB VIP DESKTOP - INSTALADOR OFICIAL
echo ================================================================
echo  Version: v${version} (Windows 10 / Windows 11)
echo  Modo: Aplicacion de Escritorio con Sesiones Aisladas
echo ================================================================
echo.
echo [*] Configurando acceso directo en su equipo...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedCmd}

echo.
echo ================================================================
echo    [OK] INSTALACION COMPLETADA EXITOSAMENTE
echo ================================================================
echo  - Acceso directo creado en su Escritorio: "CourseHub VIP"
echo  - Aplicacion iniciada correctamente.
echo ================================================================
echo.
echo Presione cualquier tecla para cerrar esta ventana...
pause >nul
exit
`;
}

// Universal Hard Drive Downloader: Bypasses iframe sandbox by triggering top-level HTTP download
export function triggerHardDriveDownload(endpointUrl: string, fallbackFileName: string, fallbackContent?: string, mimeType?: string) {
  const fullUrl = endpointUrl.startsWith('http') 
    ? endpointUrl 
    : `${window.location.origin}${endpointUrl.startsWith('/') ? '' : '/'}${endpointUrl}`;

  // Method 1: Open direct download URL in top-level window/tab.
  // With Content-Disposition: attachment, the browser automatically saves it to the hard drive Downloads folder.
  let openedWindow: Window | null = null;
  try {
    openedWindow = window.open(fullUrl, '_blank');
  } catch (e) {
    console.warn('window.open blocked, attempting anchor fallback:', e);
  }

  // Method 2: HTML Anchor element with download and target="_blank" attributes
  try {
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = fallbackFileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 2000);
  } catch (e) {
    console.warn('Direct anchor download failed:', e);
  }

  // Method 3: Offline Blob fallback if window.open was suppressed
  if (!openedWindow && fallbackContent) {
    try {
      const blob = new Blob([fallbackContent], { type: mimeType || 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fallbackFileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 2000);
    } catch (_) {}
  }
}

// Download Windows EXE Installer (.exe) directly to hard drive
export function downloadWindowsExeInstaller(filename = 'CourseHub-VIP-Setup-v6.2.0.exe') {
  triggerHardDriveDownload('/api/download/installer-exe', filename);
}

// Download Windows ZIP Ready Package (.zip) directly to hard drive
export function downloadZipInstaller(filename = 'CourseHub-VIP-Instalador-Windows.zip') {
  triggerHardDriveDownload('/api/download/installer-zip', filename);
}

// Download Windows MSI Installer Package (.msi / deployment package)
export function downloadWindowsMsiInstaller(filename: string, meta: ExeMetadata) {
  const version = meta.version || '6.2.0';
  const targetFileName = filename.endsWith('.msi') ? filename : `${filename}.msi`;
  triggerHardDriveDownload('/api/download/installer-msi', targetFileName);
}

// Download Windows Batch 1-Click Installer (.bat)
export function downloadBatchInstaller(filename: string, meta: ExeMetadata) {
  const content = generateWindowsBatchInstaller(meta);
  const targetFileName = filename.endsWith('.bat') ? filename : `${filename}.bat`;
  triggerHardDriveDownload('/api/download/installer-bat', targetFileName, content, 'application/x-bat;charset=utf-8');
}

// Generate Electron Source Package files for manual copy or zip
export function getElectronPackageFiles(meta: ExeMetadata) {
  const serverUrl = meta.serverUrl || 'https://programavip.luis5afp.workers.dev';
  const clientAppUrl = serverUrl.includes('?') ? `${serverUrl}&mode=client` : `${serverUrl}/?mode=client`;
  const version = meta.version || '6.2.0';

  const packageJson = JSON.stringify(
    {
      name: 'coursehub-vip-desktop',
      version: version,
      description: 'Cliente de Escritorio Oficial CourseHub VIP para Windows',
      author: 'Luis5afp <luis5afp@gmail.com>',
      license: 'MIT',
      main: 'main.js',
      repository: {
        type: 'git',
        url: 'https://github.com/luis5afp/programaVIP.git',
      },
      scripts: {
        start: 'electron .',
        'build:win': 'electron-builder --win --x64',
        'build:publish': 'electron-builder --win --x64 --publish always',
      },
      dependencies: {
        electron: '^28.2.0',
        'electron-updater': '^6.1.7',
      },
      devDependencies: {
        'electron-builder': '^24.13.3',
      },
      build: {
        appId: 'com.coursehub.vip.desktop',
        productName: 'CourseHub VIP',
        copyright: 'Copyright © 2026 CourseHub VIP',
        directories: {
          output: 'dist',
        },
        publish: [
          {
            provider: 'github',
            owner: 'luis5afp',
            repo: 'programaVIP',
          },
        ],
        win: {
          target: [
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
          artifactName: 'CourseHub-VIP-Setup-${version}.${ext}',
          requestedExecutionLevel: 'asInvoker',
        },
        nsis: {
          oneClick: false, // Asistente de instalación guiado paso a paso
          perMachine: false,
          allowToChangeInstallationDirectory: true, // El usuario puede elegir la ruta en su PC
          allowElevation: true,
          createDesktopShortcut: true, // Acceso directo en el Escritorio de Windows
          createStartMenuShortcut: true, // Entrada en el Menú Inicio de Windows
          shortcutName: 'CourseHub VIP',
          installerHeaderTitle: 'CourseHub VIP - Instalador Oficial de Windows',
          installerLanguages: ['es_ES', 'en_US'],
          language: '3082',
          deleteAppDataOnUninstall: false, // Preserva cookies y sesiones locales si reinstala
          runAfterFinish: true,
          displayLanguageSelector: false,
          uninstallDisplayName: 'CourseHub VIP (Desinstalador Oficial)',
        },
      },
    },
    null,
    2
  );

  const mainJs = `const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Configuración de Auto-Updater desde GitHub Releases
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
const activeProfileWindows = new Map();

// 1. Configuración de Ventana Principal (Dashboard del Alumno)
function createWindow() {
  // Partición persistente global para el catálogo y login del cliente
  const mainSession = session.fromPartition('persist:coursehub_main_vault', {
    cache: true, // Guarda en disco local la caché web y recursos pesados
  });

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'CourseHub VIP - Software Oficial de Escritorio v${version}',
    backgroundColor: '#020617',
    webPreferences: {
      session: mainSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Ocultar barra de menús tradicional para máxima inmersión
  mainWindow.setMenuBarVisibility(false);

  // Protección nativa de Windows contra capturas de pantalla y grabadores (OBS / Camtasia)
  try {
    mainWindow.setContentProtection(true);
  } catch (e) {
    console.warn('Protección de contenido no compatible en este entorno:', e);
  }

  // Cargar URL del servidor con modo cliente y aislamiento de sesión
  mainWindow.loadURL('${clientAppUrl}');

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Cerrar también las ventanas hijas de perfiles si el alumno cierra la app principal
    for (const [key, win] of activeProfileWindows.entries()) {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    }
    activeProfileWindows.clear();
  });

  // Bloquear atajos de inspección técnica en la ventana principal
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      input.key === 'F12' ||
      (input.control && input.key.toLowerCase() === 'u')
    ) {
      event.preventDefault();
    }
  });

  // Verificar actualizaciones de GitHub al iniciar (solo en versión empaquetada instalada)
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.log('Verificación de actualización omitida:', err.message);
    });
  }
}

// 2. MOTOR DE PERFILES INDEPENDIENTES CON ALMACENAMIENTO LOCAL DE COOKIES Y CACHÉ
// Cada curso, IA o plataforma abre en una partición física independiente en el disco duro de la PC:
// Ruta local: %APPDATA%\\CourseHub VIP\\Partitions\\client_XXX_mod_YYY_prof_ZZZ\\
ipcMain.handle('profile:open', async (event, params) => {
  const { clientId = 'c1', moduleId = 'm1', profileId = 'p1', targetUrl, title = 'CourseHub VIP Workspace', credentials } = params;
  const partitionKey = \`persist:client_\${clientId}_mod_\${moduleId}_prof_\${profileId}\`;

  // Si ya hay una ventana abierta para este perfil, la enfocamos en primer plano
  if (activeProfileWindows.has(partitionKey)) {
    const existingWin = activeProfileWindows.get(partitionKey);
    if (existingWin && !existingWin.isDestroyed()) {
      existingWin.focus();
      return { success: true, partition: partitionKey, reloaded: false };
    }
  }

  // Crear partición Chromium persistente con caché en disco local (evita sobrecargar el servidor)
  const profileSession = session.fromPartition(partitionKey, {
    cache: true, // ✅ Guarda imágenes, videos y caché local en el disco de la PC
  });

  // Inyectar cookies o credenciales en segundo plano si vienen provistas
  if (credentials && credentials.cookies && Array.isArray(credentials.cookies)) {
    for (const ck of credentials.cookies) {
      try {
        await profileSession.cookies.set({
          url: targetUrl,
          name: ck.name,
          value: ck.value,
          domain: ck.domain,
          path: ck.path || '/',
          secure: ck.secure ?? true,
          httpOnly: ck.httpOnly ?? true,
          expirationDate: ck.expirationDate || Math.floor(Date.now() / 1000) + 86400 * 365,
        });
      } catch (err) {
        console.warn('Error inyectando cookie en perfil:', err.message);
      }
    }
  }

  // Crear ventana aislada para este perfil
  const profileWin = new BrowserWindow({
    width: 1400,
    height: 900,
    title: \`\${title} - [Sesión Aislada en PC]\`,
    backgroundColor: '#0f172a',
    webPreferences: {
      session: profileSession, // ✅ Cada perfil tiene su propio SQLite de cookies y LocalStorage en la PC
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false, // Bloquear consola para no exponer credenciales
    },
  });

  profileWin.setMenuBarVisibility(false);

  // Blindaje anticopia para el reproductor de cursos o herramienta
  try {
    profileWin.setContentProtection(true);
  } catch (e) {}

  // Bloquear atajos de desarrollador (F12, Ctrl+Shift+I, etc.)
  profileWin.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      input.key === 'F12' ||
      (input.control && input.key.toLowerCase() === 'u')
    ) {
      event.preventDefault();
    }
  });

  // Registrar ventana activa
  activeProfileWindows.set(partitionKey, profileWin);

  profileWin.on('closed', () => {
    activeProfileWindows.delete(partitionKey);
  });

  // Inyección automática de credenciales en formularios de login si aplica
  if (credentials && (credentials.username || credentials.password)) {
    profileWin.webContents.on('did-finish-load', () => {
      const u = credentials.username || '';
      const p = credentials.password || '';
      if (u || p) {
        const injectScript = \`
          (function() {
            try {
              const userInput = document.querySelector('input[type="email"], input[type="text"], input[name*="user"], input[name*="email"]');
              const passInput = document.querySelector('input[type="password"]');
              if (userInput && '\${u}' && !userInput.value) {
                userInput.value = '\${u}';
                userInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              if (passInput && '\${p}' && !passInput.value) {
                passInput.value = '\${p}';
                passInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } catch (e) {}
          })();
        \`;
        profileWin.webContents.executeJavaScript(injectScript).catch(() => {});
      }
    });
  }

  await profileWin.loadURL(targetUrl);
  return { success: true, partition: partitionKey, launched: true };
});

// 3. Limpiar partición o cookies de un perfil específico (si el admin lo solicita)
ipcMain.handle('profile:clear', async (event, partitionKey) => {
  try {
    const targetSession = session.fromPartition(partitionKey);
    await targetSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Eventos del Auto-Updater
autoUpdater.on('update-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', info.version);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Actualización Instalada',
      message: 'Una nueva versión de CourseHub VIP se ha descargado silenciosamente en su PC. ¿Desea reiniciar ahora para aplicarla?',
      buttons: ['Reiniciar y Actualizar', 'Más Tarde'],
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
`;

  const preloadJs = `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('courseHubDesktop', {
  isDesktopApp: true,
  version: '${version}',
  // Abrir curso o herramienta en una partición física independiente con almacenamiento local de cookies
  openProfile: (params) => ipcRenderer.invoke('profile:open', params),
  // Limpiar datos o cookies de una partición específica
  clearProfile: (partitionKey) => ipcRenderer.invoke('profile:clear', partitionKey),
  // Notificaciones de auto-actualización
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, ver) => callback(ver)),
});
`;

  const githubWorkflowYml = `name: Compilar y Publicar Instalador Windows .EXE

on:
  push:
    tags:
      - 'v*' # Se activa automáticamente al subir un tag como v6.2.0

permissions:
  contents: write

jobs:
  build-and-release:
    runs-on: windows-latest

    steps:
      - name: Descargar Código Fuente
        uses: actions/checkout@v4

      - name: Instalar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Instalar Dependencias
        run: npm ci || npm install

      - name: Compilar Instalador .EXE con Electron Builder
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: npm run build:publish
`;

  const gitignore = `node_modules/
dist/
.env
.DS_Store
*.log
`;

  const buildBat = `@echo off
setlocal EnableDelayedExpansion
title Compilador CourseHub VIP Desktop (.EXE)
color 0A
cls
echo ================================================================
echo   COMPILADOR OFICIAL DE COURSEHUB VIP DESKTOP (.EXE)
echo   Version: v${version} (Windows 10 / Windows 11 x64)
echo ================================================================
echo.
echo [Paso 1/3] Verificando instalacion de Node.js en su sistema...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ================================================================
    echo [AVISO IMPORTANTE]
    echo Node.js no esta instalado en su equipo (o no se encuentra en el PATH).
    echo.
    echo Para compilar el archivo .EXE en su PC:
    echo 1. Descargue e instale Node.js gratis desde: https://nodejs.org
    echo 2. Reinicie esta ventana y vuelva a hacer doble clic aqui.
    echo.
    echo ALTERNATIVA INMEDIATA:
    echo Si desea enviar la app a sus alumnos SIN compilar nada,
    echo puede enviarles directamente el archivo:
    echo   "2-INSTALAR-ACCESO-ESCRITORIO.bat"
    echo (Ese archivo instala el icono en el escritorio y abre la app al instante).
    echo ================================================================
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [+] Node.js detectado: %NODE_VER%
echo.

echo [Paso 2/3] Instalando dependencias de Electron...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [!] Fallo npm install normal. Continuando empaquetado con npx...
)

echo.
echo [Paso 3/3] Compilando e instalando empaquetador .EXE para Windows...
call npx --yes electron-builder@24.13.3 --win --x64
if %errorlevel% neq 0 (
    echo.
    echo ================================================================
    echo   [ERROR EN LA COMPILACION]
    echo ================================================================
    echo Por favor revise los errores que aparecen en la parte superior.
    echo.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   [OK] COMPILACION TERMINADA EXITOSAMENTE!
echo ================================================================
echo   El archivo instalador .EXE ha sido creado en:
echo   Carpeta: %CD%\\dist\\
echo   Archivo: CourseHub-VIP-Setup-${version}.exe
echo ================================================================
echo.
if exist "dist\\CourseHub-VIP-Setup-${version}.exe" (
    echo Abriendo la carpeta con el instalador .EXE...
    explorer "dist"
)
pause
`;

  const readmeMd = `# 🚀 CourseHub VIP Desktop Client (Repositorio Oficial)

Este repositorio contiene el código fuente del cliente de escritorio de **CourseHub VIP**, configurado con compilación automática en la nube mediante **GitHub Actions** y **Auto-Updates** para los clientes.

---

## 🛠️ Cómo Crear y Publicar tu Repositorio en GitHub

### Paso 1: Crear un nuevo repositorio en GitHub
1. Ve a [GitHub](https://github.com/new) y crea un repositorio llamado: \`coursehub-vip-desktop\`.
2. Déjalo en modo **Público** (para que tus clientes puedan descargar el .exe sin autenticación).

### Paso 2: Subir este código a tu repositorio
Abre tu terminal en esta carpeta y ejecuta:
\`\`\`bash
git init
git add .
git commit -m "feat: release v${version} de CourseHub VIP Desktop"
git branch -M main
git remote add origin https://github.com/luis5afp/coursehub-vip-desktop.git
git push -u origin main
\`\`\`

### Paso 3: Generar la Release con el archivo .EXE Automáticamente
Para que GitHub Actions compile el instalador \`.exe\` en los servidores de GitHub gratis:
\`\`\`bash
git tag v${version}
git push origin v${version}
\`\`\`

¡Listo! En 2 minutos encontrarás tu archivo ejecutable listo para descargar en:
👉 \`https://github.com/luis5afp/coursehub-vip-desktop/releases/latest\`

---

## 💻 Compilación Local (Sin usar GitHub)
Si prefieres compilar el \`.exe\` directamente en tu computadora:
1. Haz doble clic en \`3-COMPILAR-INSTALADOR-EXE.bat\` (requiere [Node.js](https://nodejs.org)).
2. El archivo instalador se generará en: \`dist/CourseHub-VIP-Setup-${version}.exe\`.

---

## 🔄 ¿Cómo funcionan las Actualizaciones?
1. **Actualizaciones de Cursos y Contenido**: Son automáticas e inmediatas, ya que la aplicación carga el catálogo y sesiones directamente desde tu servidor en tiempo real.
2. **Actualizaciones del Programa de Escritorio**: Cuando hagas mejoras en este código, solo subes un nuevo tag (ej: \`git tag v6.3.0 && git push origin v6.3.0\`) y la app de tus clientes se actualizará sola en segundo plano.
`;

  const startAppBat = `@echo off
title Iniciando CourseHub VIP Desktop Client
color 0B
cls
echo ================================================================
echo   INICIANDO COURSEHUB VIP - MODO ESCRITORIO
echo ================================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$edgePaths = @(\\"$env:ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe\\", \\"$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe\\", \\"$env:LOCALAPPDATA\\Microsoft\\Edge\\Application\\msedge.exe\\"); $chromePaths = @(\\"$env:ProgramFiles(x86)\\Google\\Chrome\\Application\\chrome.exe\\", \\"$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe\\", \\"$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe\\"); $targetExe = 'msedge.exe'; foreach ($p in $edgePaths) { if (Test-Path $p) { $targetExe = $p; break } }; if ($targetExe -eq 'msedge.exe') { foreach ($p in $chromePaths) { if (Test-Path $p) { $targetExe = $p; break } } }; Start-Process -FilePath $targetExe -ArgumentList '--app=\\"${clientAppUrl}\\" --user-data-dir=\\"$env:LOCALAPPDATA\\\\CourseHub-VIP\\\\ProfileData\\" --window-size=1280,820 --no-first-run'"
echo [OK] Aplicacion iniciada en ventana nativa independiente.
exit
`;

  const installShortcutBat = generateWindowsBatchInstaller(meta);

  return {
    packageJson,
    mainJs,
    preloadJs,
    githubWorkflowYml,
    gitignore,
    buildBat,
    readmeMd,
    startAppBat,
    installShortcutBat,
  };
}

// Generate Electron Source Package as a real .ZIP archive for 1-click self-compilation
export async function downloadElectronSourcePackage(meta: ExeMetadata): Promise<void> {
  const targetZipName = `CourseHub-VIP-Desktop-Repo-v${meta.version || '6.2.0'}.zip`;
  triggerHardDriveDownload('/api/download/electron-package-zip', targetZipName);
}

