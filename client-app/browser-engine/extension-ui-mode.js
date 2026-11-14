// The customer's server-authorized browser UI mode. The app window hides
// Chromium/Edge chrome (including the extensions button) but does NOT replace
// Windows endpoint policy or make installed extensions a security secret.
export function normalizeBrowserExtensionsAccess(value) {
  return value === 'full' ? 'full' : 'restricted';
}

export function browserStartupArgument(initialUrl, access) {
  const url = String(initialUrl || 'about:blank');
  return normalizeBrowserExtensionsAccess(access) === 'restricted'
    ? `--app=${url}`
    : url;
}
