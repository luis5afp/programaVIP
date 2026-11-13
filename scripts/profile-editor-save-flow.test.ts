import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/views/ProfilesView.tsx', import.meta.url), 'utf8');

assert.match(source, /Guardar y cerrar/);
const submitStart = source.indexOf('async function submit');
const submitEnd = source.indexOf('async function startCapture', submitStart);
const submit = source.slice(submitStart, submitEnd);
const primarySaveIndex = submit.indexOf('const savedProfile =');
const secondarySyncIndex = submit.indexOf('await Promise.all([');
const reloadIndex = submit.indexOf('await load({ throwOnError: true });');
const closeIndex = submit.indexOf('closeEditor();');
const errorIndex = submit.indexOf('} catch (submitError: any)');
assert.ok(primarySaveIndex >= 0, 'submit must save the profile');
assert.ok(secondarySyncIndex > primarySaveIndex, 'secondary settings must be persisted after the primary save');
assert.ok(reloadIndex > secondarySyncIndex, 'reload must run after secondary persistence');
assert.ok(closeIndex > reloadIndex && closeIndex < errorIndex, 'editor must close only after confirmed saves and reload');
assert.match(submit, /if \(editor === 'new'\) setEditor\(savedProfile\)/, 'retries after creating a profile must not duplicate it');
assert.match(submit, /No se pudo guardar el perfil/, 'failed saves must show an error without closing the editor');
assert.match(submit, /Perfil guardado, pero quedó una configuración pendiente/, 'secondary failures must be clearly reported');
assert.match(source, /if \(!saving\) closeEditor\(\)/, 'user cannot close editor while saving');
assert.match(source, /key=\{previewUrl\}/, 'image preview must remount when the selected source changes');
assert.match(source, /key=\{profileImageSrc\(profile\) \|\| undefined\}/, 'profile card image must remount after an image URL change');
assert.match(source, /onLoad=\{\(event\) => \{[\s\S]{0,120}style\.display = 'block'/, 'a newly loaded image must become visible after a prior load error');

console.log('Profile editor persists and confirms saves before closing: OK');
