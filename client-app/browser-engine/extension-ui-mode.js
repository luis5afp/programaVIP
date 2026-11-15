// A restricted profile now uses an ordinary Edge tab strip so pages from
// ToolsPoint share one browser window, data directory, proxy and extensions.
// Browser Guard consolidates secondary normal windows and guards the restricted
// extensions. This is browser UI isolation, not Windows administrator policy.
export function normalizeBrowserExtensionsAccess(value) {
  return value === 'full' ? 'full' : 'restricted';
}

export function browserStartupArgument(initialUrl, access) {
  const url = String(initialUrl || 'about:blank');
  // Standard Edge with a tab strip is necessary: --app opens every new tab
  // in a *separate normal* window (confirmed in real Windows smoke tests).
  return url;
}
