export const MIN_USERFLOW_VERSION = '0.3.9';
export const MIN_SESSION_MANAGER_VERSION = '0.3.9';

function versionParts(value: string) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function compareVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function versionAtLeast(value: string | null | undefined, minimum: string) {
  const compared = compareVersions(String(value || ''), minimum);
  return compared !== null && compared >= 0;
}

export function clientVersionFrom(request: Request) {
  return (request.headers.get('x-userflow-client-version') || '').trim();
}

export function sessionManagerVersionFrom(request: Request) {
  return (request.headers.get('x-userflex-session-manager-version') || '').trim();
}
