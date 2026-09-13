import fs from 'node:fs/promises';

async function replaceChecked(file, transform) {
  const before = await fs.readFile(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No changes produced for ${file}`);
  await fs.writeFile(file, after, 'utf8');
}

await replaceChecked('client-app/main.js', (source) => {
  const marker = "    backgroundColor: '#090c12',\n    webPreferences: {";
  const count = source.split(marker).length - 1;
  if (count !== 2) throw new Error(`Expected 2 workspace window markers, found ${count}`);
  const replacement = "    backgroundColor: '#090c12',\n    titleBarStyle: 'hidden',\n    titleBarOverlay: { color: '#0c1018', symbolColor: '#cbd5e1', height: 47 },\n    webPreferences: {";
  return source.split(marker).join(replacement);
});

await replaceChecked('client-app/browser.css', (source) => {
  const row = ".tabs-row {\n  height: 47px;\n  display: flex;\n  align-items: end;\n  justify-content: flex-start;\n  gap: 6px;\n  padding: 7px 10px 0;\n  border-bottom: 1px solid #151b26;\n}";
  if (!source.includes(row)) throw new Error('browser.css tabs-row marker missing');
  const compactRow = ".tabs-row {\n  height: 47px;\n  display: flex;\n  align-items: end;\n  justify-content: flex-start;\n  gap: 6px;\n  padding: 7px 148px 0 10px;\n  border-bottom: 1px solid #151b26;\n  -webkit-app-region: drag;\n}\n\n.catalog-button,\n.new-tab-button,\n.tabs,\n.tab,\n.tab-close { -webkit-app-region: no-drag; }";
  return source.replace(row, compactRow);
});

await replaceChecked('client-app/profile-window.css', (source) => {
  const row = ".tabs-row {\n  height: 44px;\n  display: flex;\n  align-items: end;\n  gap: 5px;\n  padding: 6px 9px 0;\n  border-bottom: 1px solid #151b26;\n}";
  if (!source.includes(row)) throw new Error('profile-window.css tabs-row marker missing');
  const compactRow = ".tabs-row {\n  height: 44px;\n  display: flex;\n  align-items: end;\n  gap: 5px;\n  padding: 6px 148px 0 9px;\n  border-bottom: 1px solid #151b26;\n  -webkit-app-region: drag;\n}\n\n.profile-badge,\n.page-tabs,\n.page-tab,\n.page-close,\n.new-page-button { -webkit-app-region: no-drag; }";
  return source.replace(row, compactRow);
});

await replaceChecked('client-app/package.json', (source) => {
  if (!source.includes('"version": "0.2.22"')) throw new Error('package version marker missing');
  return source.replace('"version": "0.2.22"', '"version": "0.2.23"');
});

await replaceChecked('client-app/index.html', (source) => {
  const count = source.split('v0.2.22').length - 1;
  if (count < 1) throw new Error('index version marker missing');
  return source.split('v0.2.22').join('v0.2.23');
});

console.log('Applied compact hidden titlebar + v0.2.23 changes.');
