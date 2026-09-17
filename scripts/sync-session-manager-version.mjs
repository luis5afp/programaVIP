import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const viewPath = path.join(root, 'src', 'views', 'ProfilesView.tsx');
const packagePath = path.join(root, 'session-manager', 'package.json');
const sessionManagerPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = String(sessionManagerPackage.version || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid Session Manager version: ${version || '(empty)'}`);
}

let source = fs.readFileSync(viewPath, 'utf8');
source = source
  .replace(/session-manager-v\d+\.\d+\.\d+\/userFLEX-Session-Manager-\d+\.\d+\.\d+-Setup\.exe/g,
    `session-manager-v${version}/userFLEX-Session-Manager-${version}-Setup.exe`)
  .replace(/Instalar \/ actualizar Session Manager v\d+\.\d+\.\d+/g,
    `Instalar / actualizar Session Manager v${version}`);

fs.writeFileSync(viewPath, source);
console.log(`Admin Session Manager download points to v${version}.`);
