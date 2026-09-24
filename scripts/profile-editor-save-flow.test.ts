import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(source, /Guardar y cerrar/);
const submitStart = source.indexOf('async function submit');
const closeIndex = source.indexOf('closeEditor();', submitStart);
const profileUrlIndex = source.indexOf('const profileUrlValue', submitStart);
const primarySaveIndex = source.indexOf('const savedProfile =', submitStart);
const secondarySyncIndex = source.indexOf('await Promise.all([', submitStart);
assert.ok(closeIndex > submitStart, 'submit must close the editor');
assert.ok(profileUrlIndex > closeIndex, 'editor must close after local validation and before network-dependent work');
assert.ok(primarySaveIndex > closeIndex, 'editor must close before the primary network save');
assert.ok(secondarySyncIndex > primarySaveIndex, 'secondary synchronization must happen after the primary save');
assert.doesNotMatch(source, /setSuccess\(confirmation\);[\s\S]{0,100}closeEditor\(\);/, 'editor must not wait until the final confirmation to close');
assert.match(source, /El perfil se guardó, pero no se pudo completar toda la configuración/, 'secondary failures must be reported after the modal has closed');
assert.match(source, /if \(!saving\) closeEditor\(\)/);
assert.match(source, /await Promise\.all\(\[/);
assert.match(source, /key=\{previewUrl\}/, 'image preview must remount when the selected source changes');
assert.match(source, /key=\{profileImageSrc\(profile\) \|\| undefined\}/, 'profile card image must remount after an image URL change');
assert.match(source, /onLoad=\{\(event\) => \{[\s\S]{0,120}style\.display = 'block'/, 'a newly loaded image must become visible after a prior load error');

console.log('Profile editor save/confirm/close flow: OK');
