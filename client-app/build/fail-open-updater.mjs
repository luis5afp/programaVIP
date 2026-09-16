import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
const marker = '// userFLOW updater fail-open v2';
let source = await fs.readFile(bootstrapPath, 'utf8');

// GitHub's Windows runner may check out JavaScript with CRLF. Normalize the
// source before applying the deterministic patch so the build behaves the same
// on Windows and development machines using LF.
source = source.replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const startMainStart = source.indexOf('async function startMain() {');
  const startMainEnd = source.indexOf('\nfunction validateManifest(', startMainStart);
  if (startMainStart < 0 || startMainEnd < 0) {
    throw new Error('Could not locate startMain() in bootstrap.js');
  }

  const resilientStartMain = `async function startMain() {\n  if (mainStarted) return;\n  mainStarted = true;\n  pushStatus({ phase: 'ready', message: \`v\${app.getVersion()} · Listo\`, percent: null });\n  await wait(80);\n\n  try {\n    // main.js now creates the visible userFLOW window synchronously when it is\n    // imported. Keep the splash alive only until that window actually exists.\n    await import('./main.js');\n    await waitForMainWindow();\n\n    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();\n    splashWindow = null;\n  } catch (error) {\n    // Never leave the splash permanently locked because a main-window startup\n    // attempt failed. A later retry must be allowed to run.\n    mainStarted = false;\n    throw error;\n  }\n}\n`;
  source = source.slice(0, startMainStart) + resilientStartMain + source.slice(startMainEnd);

  const oldCatch = `  } catch (error) {\n    console.error('userFLOW updater error', error instanceof Error ? error.message : String(error));\n    pushStatus({\n      phase: 'error',\n      message: 'No se pudo descargar o verificar la actualización. Revisa tu conexión y reintenta.',\n      percent: null,\n    });\n  } finally {`;

  const newCatch = `  } catch (error) {\n    ${marker}\n    console.error('userFLOW updater/startup error', error instanceof Error ? error.message : String(error));\n    pushStatus({\n      phase: 'ready',\n      message: \`No se pudo verificar la actualización · abriendo v\${app.getVersion()}…\`,\n      percent: null,\n    });\n    // Update availability is best-effort. Start the installed version almost\n    // immediately instead of holding the user on the splash screen.\n    await wait(120);\n    try {\n      await startMain();\n    } catch (startError) {\n      console.error('userFLOW main startup error', startError instanceof Error ? startError.message : String(startError));\n      pushStatus({\n        phase: 'error',\n        message: 'No se pudo abrir userFLOW. Cierra el programa y vuelve a intentarlo.',\n        percent: null,\n      });\n    }\n  } finally {`;

  if (!source.includes(oldCatch)) {
    throw new Error('Could not locate updater error handler in bootstrap.js');
  }
  source = source.replace(oldCatch, newCatch);
  await fs.writeFile(bootstrapPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW fail-open updater v2 ready.');
