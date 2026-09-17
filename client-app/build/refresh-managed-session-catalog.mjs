import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.resolve(here, '..', 'renderer.js');
const marker = '// userFLOW managed-session catalog focus refresh v1';
let source = fs.readFileSync(rendererPath, 'utf8');

if (!source.includes(marker)) {
  source += `\n\n${marker}\nlet lastAutomaticCatalogRefreshAt = 0;\n\nfunction refreshCatalogWhenVisible() {\n  if (!auth || !catalog || document.visibilityState === 'hidden') return;\n  const now = Date.now();\n  if (now - lastAutomaticCatalogRefreshAt < 4000) return;\n  lastAutomaticCatalogRefreshAt = now;\n  void refreshCatalog();\n}\n\nwindow.addEventListener('focus', refreshCatalogWhenVisible);\ndocument.addEventListener('visibilitychange', () => {\n  if (document.visibilityState === 'visible') refreshCatalogWhenVisible();\n});\n`;
  fs.writeFileSync(rendererPath, source);
}

const check = spawnSync(process.execPath, ['--check', rendererPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log('userFLOW managed-session catalog focus refresh ready.');
