import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(source, /Guardar y cerrar/);
assert.match(source, /setSuccess\(confirmation\);[\s\S]{0,80}closeEditor\(\);[\s\S]{0,80}await load\(\);/);
assert.doesNotMatch(source, /setSuccess\(confirmation\);[\s\S]{0,80}closeEditor\(\);[\s\S]{0,80}void load\(\);/);
assert.match(source, /if \(!saving\) closeEditor\(\)/);
assert.match(source, /await Promise\.all\(\[/);

console.log('Profile editor save/confirm/close flow: OK');
