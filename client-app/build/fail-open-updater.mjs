import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapPath = path.resolve(here, '..', 'bootstrap.js');
const marker = '// userFLOW updater fail-open v1';
let source = await fs.readFile(bootstrapPath, 'utf8');

if (!source.includes(marker)) {
  source = source.replace(
    "  pushStatus({ phase: 'ready', message: `v${app.getVersion()} · Actualizado`, percent: null });",
    "  pushStatus({ phase: 'ready', message: `v${app.getVersion()} · Listo`, percent: null });",
  );

  const oldCatch = `  } catch (error) {\n    console.error('userFLOW updater error', error instanceof Error ? error.message : String(error));\n    pushStatus({\n      phase: 'error',\n      message: 'No se pudo descargar o verificar la actualización. Revisa tu conexión y reintenta.',\n      percent: null,\n    });\n  } finally {`;

  const newCatch = `  } catch (error) {\n    ${marker}\n    console.error('userFLOW updater error', error instanceof Error ? error.message : String(error));\n    pushStatus({\n      phase: 'ready',\n      message: \`No se pudo verificar la actualización · abriendo v\${app.getVersion()}…\`,\n      percent: null,\n    });\n    // Updating userFLOW is best-effort. A temporary outage of the update service\n    // must never prevent the already installed, verified application from starting.\n    // The next application launch will automatically try the update check again.\n    await wait(900);\n    await startMain();\n  } finally {`;

  if (!source.includes(oldCatch)) {
    throw new Error('Could not locate updater error handler in bootstrap.js');
  }
  source = source.replace(oldCatch, newCatch);
  await fs.writeFile(bootstrapPath, source, 'utf8');
}

const check = spawnSync(process.execPath, ['--check', bootstrapPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW fail-open updater ready.');
