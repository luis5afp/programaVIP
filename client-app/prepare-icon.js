import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(__dirname, 'assets', 'userflow.ico');
const target = path.join(__dirname, 'assets', 'userflow.png');
const data = fs.readFileSync(source);

if (data.length < 22 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) {
  throw new Error('userFLOW icon is not a valid ICO container.');
}

const count = data.readUInt16LE(4);
let best = null;
for (let index = 0; index < count; index += 1) {
  const entry = 6 + index * 16;
  if (entry + 16 > data.length) break;
  const width = data[entry] === 0 ? 256 : data[entry];
  const height = data[entry + 1] === 0 ? 256 : data[entry + 1];
  const size = data.readUInt32LE(entry + 8);
  const offset = data.readUInt32LE(entry + 12);
  if (offset + size > data.length) continue;
  const signature = data.subarray(offset, offset + 8);
  const isPng = signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) continue;
  const area = width * height;
  if (!best || area > best.area) best = { offset, size, area, width, height };
}

if (!best) throw new Error('userFLOW ICO does not contain a PNG image.');
fs.writeFileSync(target, data.subarray(best.offset, best.offset + best.size));
console.log(`Prepared userFLOW ${best.width}x${best.height} PNG icon.`);
