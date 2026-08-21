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

// Download Windows Batch 1-Click Installer (.bat)
export function downloadBatchInstaller(filename: string, meta: ExeMetadata) {
  const content = generateWindowsBatchInstaller(meta);
  const targetFileName = filename.endsWith('.bat') ? filename : `${filename}.bat`;

  try {
    const blob = new Blob([content], { type: 'application/x-bat;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = targetFileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  } catch (e) {
    console.warn('Blob download failed, using Data URI fallback:', e);
    try {
      const encodedData = encodeURIComponent(content);
      const dataUri = `data:text/plain;charset=utf-8,${encodedData}`;
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', targetFileName);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) document.body.removeChild(link);
      }, 1000);
    } catch (e2) {
      console.error('All download methods failed:', e2);
    }
  }
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
        },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          allowElevation: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: 'CourseHub VIP',
          installerIcon: 'icon.ico',
          uninstallerIcon: 'icon.ico',
          installerHeaderTitle: 'CourseHub VIP - Instalador Oficial',
          installerLanguages: ['es_ES', 'en_US'],
          language: '3082',
          deleteAppDataOnUninstall: false,
          runAfterFinish: true,
          displayLanguageSelector: false,
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

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'CourseHub VIP - Cliente de Escritorio v${version}',
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:coursehub_client_vip',
    },
  });

  // Ocultar barra de menús tradicional para apariencia de app nativa
  mainWindow.setMenuBarVisibility(false);

  // Cargar URL del servidor con modo cliente y aislamiento de sesión
  mainWindow.loadURL('${clientAppUrl}');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Verificar actualizaciones de GitHub al iniciar
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.log('Verificación de actualización omitida:', err.message);
    });
  }
}

// Eventos del Auto-Updater
autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info.version);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Actualización Lista',
      message: 'Una nueva versión de CourseHub VIP se ha descargado. ¿Deseas reiniciar ahora para aplicarla?',
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
title Compilador CourseHub VIP Desktop (.EXE)
color 0A
cls
echo ================================================================
echo   COMPILADOR OFICIAL DE COURSEHUB VIP DESKTOP (.EXE)
echo ================================================================
echo.
echo Verificando instalacion de Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js no esta instalado en este equipo.
    echo Por favor descargue e instale Node.js desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detectado.
echo.
echo [1/2] Instalando dependencias de Electron (esto toma unos segundos)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Fallo npm install. Verifique su conexion a internet.
    pause
    exit /b 1
)

echo.
echo [2/2] Compilando instalador .EXE para Windows x64...
call npm run build:win

echo.
echo ================================================================
echo   [OK] COMPILACION TERMINADA EXITOSAMENTE!
echo ================================================================
echo   El archivo instalador .EXE esta listo dentro de la carpeta:
echo   .\\dist\\CourseHub-VIP-Setup-${version}.exe
echo ================================================================
echo.
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

  // Method: Pure client-side JSZip Blob generation (standard valid ZIP file format)
  try {
    const files = getElectronPackageFiles(meta);
    const zip = new JSZip();
    zip.file('.github/workflows/build-release.yml', files.githubWorkflowYml);
    zip.file('.gitignore', files.gitignore);
    zip.file('1-INICIAR-APP-DIRECTO.bat', files.startAppBat);
    zip.file('2-INSTALAR-ACCESO-ESCRITORIO.bat', files.installShortcutBat);
    zip.file('3-COMPILAR-INSTALADOR-EXE.bat', files.buildBat);
    zip.file('package.json', files.packageJson);
    zip.file('main.js', files.mainJs);
    zip.file('preload.js', files.preloadJs);
    zip.file('LEEME-INSTRUCCIONES.txt', files.readmeMd);
    zip.file('README.md', files.readmeMd);

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = targetZipName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 3000);
  } catch (e) {
    console.warn('Client JSZip generation failed, falling back to server route:', e);
    try {
      const link = document.createElement('a');
      link.href = '/api/download/electron-package-zip';
      link.download = targetZipName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) document.body.removeChild(link);
      }, 1000);
    } catch (e2) {
      console.error('Server zip fallback failed:', e2);
    }
  }
}

