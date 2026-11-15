import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_RELEASES_API, MANUAL_DOWNLOAD_PAGE, selectVerifiedGithubRelease,
  compareUpdaterVersions, updaterErrorReason,
} from '../client-app/updater-release-fallback.js';

const bootstrap = readFileSync(new URL('../client-app/bootstrap.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../client-app/package.json', import.meta.url), 'utf8'));
const digest = '6519692fa1396068fd60705da150f906e826ee0f165a8b6f243f90ef9a71af57';
const version = '0.3.112';
const url = 'https://github.com/luis5afp/programaVIP/releases/download/client-v' + version
  + '/userFLOW-' + version + '-Setup.exe';
const item = (changes = {}) => ({
  tag_name: 'client-v' + version,
  draft: false,
  prerelease: false,
  assets: [{
    name: 'userFLOW-' + version + '-Setup.exe',
    browser_download_url: url, size: 124541751, digest: 'sha256:' + digest,
  }],
  ...changes,
});
assert.equal(PUBLIC_RELEASES_API, 'https://api.github.com/repos/luis5afp/programaVIP/releases?per_page=12');
assert.equal(MANUAL_DOWNLOAD_PAGE, 'https://github.com/luis5afp/programaVIP/releases');
assert.deepEqual(selectVerifiedGithubRelease([item()]), {
  version, size: 124541751, sha256: digest,
  githubDownloadUrl: url, source: 'github-verified-release',
});
assert.equal(selectVerifiedGithubRelease([item({ draft: true })]), null);
assert.equal(selectVerifiedGithubRelease([item({ prerelease: true })]), null);
assert.equal(selectVerifiedGithubRelease([item({ tag_name: 'not-a-client-version' })]), null);
assert.equal(selectVerifiedGithubRelease([item({ assets: [{ ...item().assets[0], digest: undefined }] })]), null);
assert.equal(selectVerifiedGithubRelease([item({ assets: [{ ...item().assets[0],
  browser_download_url: 'https://attacker.example/installer.exe' }] })]), null);
assert.equal(selectVerifiedGithubRelease([item({ assets: [{ ...item().assets[0], size: 500_000_000 }] })]), null);
assert.equal(selectVerifiedGithubRelease([item({ assets: [{ ...item().assets[0], digest: 'sha256:invalid' }] })]), null);
assert.equal(selectVerifiedGithubRelease(null) === null, false);
assert.equal(compareUpdaterVersions('0.3.113', '0.3.112'), 1);
assert.equal(compareUpdaterVersions('0.3.112', '0.3.113'), -1);
assert.equal(compareUpdaterVersions('0.3.112', '0.3.112'), 0);
assert.equal(updaterErrorReason({ cause: { code: 'ENOTFOUND' } }), 'ENOTFOUND');
assert.ok(pkg.build?.files?.includes('updater-release-fallback.js'), 'release fallback must be packaged');
assert.match(bootstrap, /net\.fetch\(url, options\)/, 'Chromium network must be available for Windows proxy/TLS fallback');
assert.match(bootstrap, /User-Agent/, 'Cloudflare Worker requests should identify userFLOW');
assert.match(bootstrap, /const verified = await fetchVerifiedGithubRelease\(\)/);
assert.match(bootstrap, /if \(manifest\.githubDownloadUrl\) return downloadGithubInstaller\(manifest\)/);
assert.match(bootstrap, /hash\.digest\('hex'\) !== manifest\.sha256/,
  'GitHub EXE hash verification must use the SHA-256 in the authenticated asset metadata');
assert.match(bootstrap, /await verifyInstallerOnDisk\(installerPath, manifest\)/,
  'all installer sources must be re-verified before execution');
console.log('userFLOW updater mirror: validated release metadata, network fallback, SHA-256: OK');
