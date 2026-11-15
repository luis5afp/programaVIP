// The official release mirror is used only if the primary Cloudflare/R2
// update API is unavailable. No GitHub account, API key or third-party service.
const GITHUB_API_ORIGIN = 'https://api.github.com';
const RELEASE_PAGE_ORIGIN = 'https://github.com/luis5afp/programaVIP';
const RELEASE_NAME_RE = /^client-v(\d+\.\d+\.\d+)$/;
const MAX_INSTALLER_BYTES = 300 * 1024 * 1024;

function versionNumbers(version) {
  return String(version || '').split('.').map((n) => Number(n));
}

export function compareUpdaterVersions(left, right) {
  const a = versionNumbers(left);
  const b = versionNumbers(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((x) => !Number.isSafeInteger(x) || x < 0)) {
    return 0;
  }
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export const PUBLIC_RELEASES_API = GITHUB_API_ORIGIN + '/repos/luis5afp/programaVIP/releases?per_page=12';
export const MANUAL_DOWNLOAD_PAGE = RELEASE_PAGE_ORIGIN + '/releases';

export function selectVerifiedGithubRelease(releases) {
  if (!Array.isArray(releases)) throw new Error('GITHUB_RELEASE_DATA_INVALID');
  const candidates = [];
  for (const release of releases) {
    if (release?.draft || release?.prerelease) continue;
    const match = String(release?.tag_name || '').match(RELEASE_NAME_RE);
    if (!match) continue;
    const version = match[1];
    const expectedName = 'userFLOW-' + version + '-Setup.exe';
    const expectedUrl = RELEASE_PAGE_ORIGIN + '/releases/download/client-v' + version + '/' + expectedName;
    const asset = (Array.isArray(release?.assets) ? release.assets : [])
      .find((entry) => entry?.name === expectedName && entry?.browser_download_url === expectedUrl);
    if (!asset) continue;
    const size = Number(asset.size);
    const digest = String(asset.digest || '').trim().toLowerCase();
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INSTALLER_BYTES) continue;
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) continue;
    candidates.push({
      version, size, sha256: digest.slice('sha256:'.length),
      githubDownloadUrl: expectedUrl,
      source: 'github-verified-release',
    });
  }
  candidates.sort((a, b) => compareUpdaterVersions(b.version, a.version));
  return candidates[0] || null;
}

export function updaterErrorReason(error) {
  const value = String(error?.cause?.code || error?.code || error?.name || 'UNKNOWN');
  return value.replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 60) || 'UNKNOWN';
}
