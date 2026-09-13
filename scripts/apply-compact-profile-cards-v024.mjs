import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`No se encontró el bloque esperado: ${label}`);
  return text.replace(from, to);
}

const cssPath = 'client-app/styles.css';
let css = fs.readFileSync(cssPath, 'utf8');

css = replaceOnce(css,
`  width: min(1450px, calc(100% - 46px));\n  margin: 0 auto;\n  padding: 26px 0 44px;`,
`  width: min(1540px, calc(100% - 40px));\n  margin: 0 auto;\n  padding: 20px 0 44px;`,
'catalog-content');

css = replaceOnce(css,
`.profiles-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 18px 24px;\n}`,
`.profiles-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));\n  gap: 14px;\n  align-items: stretch;\n}`,
'profiles-grid');

css = replaceOnce(css,
`.profile-card {\n  min-height: 132px;\n  position: relative;\n  overflow: hidden;\n  display: grid;\n  grid-template-columns: 58px minmax(0, 1fr);\n  grid-template-rows: 1fr auto;\n  column-gap: 16px;\n  row-gap: 11px;\n  align-items: center;\n  padding: 22px 20px 15px;`,
`.profile-card {\n  min-height: 102px;\n  position: relative;\n  overflow: hidden;\n  display: grid;\n  grid-template-columns: 44px minmax(0, 1fr);\n  grid-template-rows: 1fr auto;\n  column-gap: 11px;\n  row-gap: 7px;\n  align-items: center;\n  padding: 13px 14px 10px;`,
'profile-card geometry');

css = replaceOnce(css,
`  border-radius: 13px;\n  background:\n    linear-gradient(145deg, rgba(19, 25, 36, .96), rgba(9, 13, 20, .98));`,
`  border-radius: 11px;\n  background:\n    linear-gradient(145deg, rgba(19, 25, 36, .96), rgba(9, 13, 20, .98));`,
'profile-card radius');

css = replaceOnce(css,
`  width: 130px;\n  height: 130px;\n  left: -52px;\n  top: -58px;`,
`  width: 100px;\n  height: 100px;\n  left: -42px;\n  top: -46px;`,
'profile-card glow');

css = replaceOnce(css,
`  width: 56px;\n  height: 56px;\n  border-radius: 13px;`,
`  width: 44px;\n  height: 44px;\n  border-radius: 11px;`,
'profile image size');

css = replaceOnce(css,
`  font-size: 22px;\n  font-weight: 900;\n  border: 1px solid #2a3240;\n  box-shadow: 0 8px 24px rgba(0, 0, 0, .20);`,
`  font-size: 18px;\n  font-weight: 900;\n  border: 1px solid #2a3240;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, .18);`,
'profile image typography');

css = replaceOnce(css,
`  font-size: 17px;\n  line-height: 1.25;`,
`  font-size: 14px;\n  line-height: 1.2;`,
'profile title size');

css = replaceOnce(css,
`  margin: 7px 0 0;\n  color: #959dad;\n  font-size: 12px;`,
`  margin: 4px 0 0;\n  color: #959dad;\n  font-size: 11px;`,
'profile description size');

css = replaceOnce(css,
`  gap: 12px;\n  min-width: 0;\n  padding-top: 2px;`,
`  gap: 9px;\n  min-width: 0;\n  padding-top: 0;`,
'card footer spacing');

css = replaceOnce(css,
`  gap: 6px;\n  min-width: 0;\n  color: #707b8d;\n  font-size: 10px;`,
`  gap: 5px;\n  min-width: 0;\n  color: #707b8d;\n  font-size: 9px;`,
'availability size');

css = replaceOnce(css,
`.availability::before { content: ''; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--green); box-shadow: 0 0 9px rgba(66, 216, 157, .42); }`,
`.availability::before { content: ''; width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px rgba(66, 216, 157, .42); }`,
'availability dot');

css = replaceOnce(css,
`  color: #929cab;\n  font-size: 10px;`,
`  color: #929cab;\n  font-size: 9px;`,
'card state size');

css = css.replace(`  .profiles-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n`, '');
css = css.replace(`  .profiles-grid { grid-template-columns: 1fr; }\n`, '');

fs.writeFileSync(cssPath, css);

const indexPath = 'client-app/index.html';
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replaceAll('v0.2.23', 'v0.2.24');
fs.writeFileSync(indexPath, html);

const packagePath = 'client-app/package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '0.2.24';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Compact profile cards v0.2.24 applied.');
