import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(__dirname, 'userflow-icon.b64');
const target = path.join(__dirname, '..', 'assets', 'userflow.png');

const base64 = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
const data = Buffer.from(base64, 'base64');
if (!data.length) throw new Error('ICON_SOURCE_EMPTY');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, data);
console.log(`Prepared userFLOW icon: ${target} (${data.length} bytes)`);
