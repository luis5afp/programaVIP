import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partsDir = path.join(__dirname, 'icon-parts');
const target = path.join(__dirname, '..', 'assets', 'userflow.png');

const parts = fs.readdirSync(partsDir)
  .filter((name) => /^\d+\.b64$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

if (!parts.length) throw new Error('ICON_SOURCE_PARTS_MISSING');

const base64 = parts
  .map((name) => fs.readFileSync(path.join(partsDir, name), 'utf8').replace(/\s+/g, ''))
  .join('');
const data = Buffer.from(base64, 'base64');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (data.length < 1024 || !data.subarray(0, 8).equals(pngSignature)) {
  throw new Error('ICON_SOURCE_INVALID_PNG');
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, data);
console.log(`Prepared approved round userFLOW icon: ${target} (${data.length} bytes)`);
