import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../client-app/' + name, import.meta.url), 'utf8');
const html = read('index.html');
const script = read('renderer.js');
const css = read('styles.css');
const pkg = JSON.parse(read('package.json'));

assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'desktop must use a valid semantic version');
for (const theme of ['claro', 'gris', 'noche']) {
  assert.match(html, new RegExp('data-theme-option="' + theme + '"'),
    'theme must have an accessible action in header: ' + theme);
  assert.match(css, new RegExp('\\[data-theme="' + theme + '"\\]'),
    'theme requires scoped style variables: ' + theme);
}
assert.match(html, /role="group" aria-label="Tema de userFLOW"/);
assert.match(script, /window\.localStorage\.setItem\(THEME_KEY, selected\)/,
  'theme should persist locally without server requests');
assert.match(script, /window\.localStorage\.getItem\(THEME_KEY\)/);
assert.match(script, /return AVAILABLE_THEMES\.has\(stored\) \? stored : 'gris'/,
  'new users should start with less-dark gray theme');
assert.match(script, /if \(launchingProfiles\.has\(profile\.id\)\) return/,
  'double clicks should not start duplicate profile launches');
assert.match(script, /syncProfileLaunching\(profile\.id, true\)/);
assert.match(script, /syncProfileLaunching\(profile\.id, false\)/);
assert.match(script, /if \(launchingProfiles\.has\(profile\.id\)\) showProfileLaunching\(card, true\)/,
  'heartbeat catalog renders must not reset a launching card');
assert.match(script, /card\.setAttribute\('aria-busy', String\(launching\)\)/);
assert.match(script, /state\.setAttribute\('aria-live', 'polite'\)/);
assert.match(css, /\.profile-card\.launching \.card-state::before/,
  'loading button must show a visible spinner');
assert.match(css, /\.profile-card\.launching::after/,
  'loading card must display an indeterminate progress line');
assert.match(css, /prefers-reduced-motion: reduce/,
  'animations must honor reduced-motion preferences');
assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  'profile cards should have a compact 4-column desktop grid');
assert.doesNotMatch(script, /ipcRenderer\.invoke\([^)]*theme/i,
  'local theme preferences should not call the server');
console.log('userFLOW theme selection and double-click protection: OK');
