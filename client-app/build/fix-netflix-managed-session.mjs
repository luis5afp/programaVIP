import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(__dirname, '..', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

const cookieOnlyClear = "  await browserSession.clearStorageData({ storages: ['cookies'] });";
const fullPartitionClear = "  // Each profile has its own persistent partition. Clear stale cookies,\n  // IndexedDB, local storage, service workers and cache before replaying a\n  // managed session so device-specific state from an older Netflix session\n  // cannot conflict with the newly delivered authentication cookies.\n  await browserSession.clearStorageData();";

if (source.includes(cookieOnlyClear)) {
  source = source.replace(cookieOnlyClear, fullPartitionClear);
}

const storageAnchor = "  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;\n  if (!storage) return;";
const netflixAwareStorage = "  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;\n  if (!storage) return;\n\n  // Netflix binds part of its browser state to the local device/runtime.\n  // Cookies are portable enough for the managed-login handoff, but copying\n  // localStorage/sessionStorage from the admin capture browser can make the\n  // client look like a stale or different device and Netflix then reports the\n  // session as expired. Let Netflix create fresh per-device web storage after\n  // the authenticated cookies have been restored.\n  const managedHost = new URL(profile.url).hostname.toLowerCase();\n  const skipPortablePageStorage = managedHost === 'netflix.com' || managedHost.endsWith('.netflix.com');\n  if (skipPortablePageStorage) return;";

if (!source.includes('const skipPortablePageStorage =')) {
  if (!source.includes(storageAnchor)) {
    throw new Error('Could not locate managed-session storage restore block in main.js');
  }
  source = source.replace(storageAnchor, netflixAwareStorage);
}

if (!source.includes('await browserSession.clearStorageData();')) {
  throw new Error('Managed-session partition reset patch was not applied');
}

fs.writeFileSync(mainPath, source);
console.log('Applied Netflix managed-session portability fix.');
