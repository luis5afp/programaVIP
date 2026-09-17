import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewPath = path.join(__dirname, '..', 'src', 'views', 'ProfilesView.tsx');
let source = fs.readFileSync(viewPath, 'utf8');

source = source
  .replace(/session-manager-v0\.1\.\d+\/userFLEX-Session-Manager-0\.1\.\d+-Setup\.exe/g,
    'session-manager-v0.1.9/userFLEX-Session-Manager-0.1.9-Setup.exe')
  .replace(/Instalar \/ actualizar Session Manager v0\.1\.\d+/g,
    'Instalar / actualizar Session Manager v0.1.9');

fs.writeFileSync(viewPath, source);
console.log('Admin Session Manager download points to v0.1.9.');
