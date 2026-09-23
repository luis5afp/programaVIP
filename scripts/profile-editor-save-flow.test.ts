import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(source, /Guardar y cerrar/);
assert.match(source, /setSuccess\(confirmation\);[\s\S]{0,80}closeEditor\(\);[\s\S]{0,80}await load\(\);/);
assert.doesNotMatch(source, /setSuccess\(confirmation\);[\s\S]{0,80}closeEditor\(\);[\s\S]{0,80}void load\(\);/);
assert.match(source, /if \(!saving\) closeEditor\(\)/);
assert.match(source, /await Promise\.all\(\[/);
assert.match(source, /key=\{previewUrl\}/, 'image preview must remount when the selected source changes');
assert.match(source, /key=\{profileImageSrc\(profile\) \|\| undefined\}/, 'profile card image must remount after an image URL change');
assert.match(source, /onLoad=\{\(event\) => \{[\s\S]{0,120}style\.display = 'block'/, 'a newly loaded image must become visible after a prior load error');

console.log('Profile editor save/confirm/close flow: OK');
