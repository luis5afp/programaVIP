import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
const packagePath = path.join(clientDir, 'package.json');
const indexPath = path.join(clientDir, 'index.html');
const rendererPath = path.join(clientDir, 'renderer.js');

const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const version = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid userFLOW package version');

let html = (await fs.readFile(indexPath, 'utf8')).replace(/\r\n/g, '\n');
html = html.replace(
  /(<span[^>]*data-userflow-version[^>]*>)v[^<]*(<\/span>)/g,
  `$1v${version}$2`,
);
html = html.replace(
  '<p>Conectando con el servidor…</p>',
  '<p id="startup-status">Iniciando userFLOW…</p>',
);
await fs.writeFile(indexPath, html, 'utf8');

let renderer = (await fs.readFile(rendererPath, 'utf8')).replace(/\r\n/g, '\n');

const staleVersionBlock = `const installedVersion = String(window.userflex?.version || '').trim();\nif (installedVersion) {\n  for (const element of document.querySelectorAll('[data-userflow-version]')) {\n    element.textContent = \`v\${installedVersion}\`;\n  }\n}\n\n`;
renderer = renderer.replace(staleVersionBlock, '');

const bridgeMarker = "const categoryFilters = document.getElementById('category-filters');\n";
const bridgeGuardMarker = '// userFLOW renderer bridge guard v1';
if (!renderer.includes(bridgeGuardMarker)) {
  if (!renderer.includes(bridgeMarker)) throw new Error('Could not locate renderer bridge insertion point');
  const bridgeGuard = `${bridgeMarker}\n${bridgeGuardMarker}\nif (!window.userflex || typeof window.userflex.bootstrap !== 'function') {\n  const unavailable = {\n    message: 'No se pudo iniciar el componente local de userFLOW. Cierra el programa y vuelve a abrirlo.',\n    code: 'LOCAL_BRIDGE_UNAVAILABLE',\n    status: 0,\n  };\n  window.userflex = {\n    bootstrap: async () => ({ authenticated: false, error: unavailable }),\n    login: async () => ({ ok: false, error: unavailable }),\n    catalog: async () => ({ ok: false, error: unavailable }),\n    launchProfile: async () => ({ ok: false, error: unavailable }),\n    logout: async () => ({ ok: false, error: unavailable }),\n    onHeartbeat: () => () => {},\n    onAuthInvalidated: () => () => {},\n  };\n}\n`;
  renderer = renderer.replace(bridgeMarker, bridgeGuard);
}

const timeoutMarker = '// userFLOW bootstrap timeout v1';
if (!renderer.includes(timeoutMarker)) {
  const startupCall = '  const result = await window.userflex.bootstrap();';
  if (!renderer.includes(startupCall)) throw new Error('Could not locate renderer bootstrap call');
  const timeoutHelper = `${timeoutMarker}\nfunction bootstrapWithTimeout(timeoutMs = 30000) {\n  let timer = null;\n  const timeout = new Promise((resolve) => {\n    timer = setTimeout(() => resolve({\n      authenticated: false,\n      error: {\n        message: 'El inicio de userFLOW tardó demasiado. Verifica tu conexión y vuelve a intentarlo.',\n        code: 'BOOTSTRAP_TIMEOUT',\n        status: 0,\n      },\n    }), timeoutMs);\n  });\n  return Promise.race([window.userflex.bootstrap(), timeout]).finally(() => {\n    if (timer) clearTimeout(timer);\n  });\n}\n\n`;
  renderer = renderer.replace('(async () => {\n', `${timeoutHelper}(async () => {\n`);
  renderer = renderer.replace(startupCall, '  const result = await bootstrapWithTimeout();');
}

await fs.writeFile(rendererPath, renderer, 'utf8');

const check = spawnSync(process.execPath, ['--check', rendererPath], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log(`userFLOW UI finalized for v${version}.`);
