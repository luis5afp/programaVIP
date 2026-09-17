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

const originalStorageAnchor = "  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;\n  if (!storage) return;";
const optimizedStorageAnchor = "  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;\n  if (storage) {";
const netflixPrelude = "  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;\n\n  // Netflix binds part of its browser state to the local device/runtime.\n  // Cookies are portable enough for the managed-login handoff, but copying\n  // localStorage/sessionStorage from the admin capture browser can make the\n  // client look like a stale or different device and Netflix then reports the\n  // session as expired. Let Netflix create fresh per-device web storage after\n  // the authenticated cookies have been restored.\n  const managedHost = new URL(profile.url).hostname.toLowerCase();\n  const skipPortablePageStorage = managedHost === 'netflix.com' || managedHost.endsWith('.netflix.com');";

if (!source.includes('const skipPortablePageStorage =')) {
  if (source.includes(optimizedStorageAnchor)) {
    source = source.replace(optimizedStorageAnchor, `${netflixPrelude}\n  if (storage && !skipPortablePageStorage) {`);
  } else if (source.includes(originalStorageAnchor)) {
    source = source.replace(originalStorageAnchor, `${netflixPrelude}\n  if (!storage || skipPortablePageStorage) return;`);
  } else {
    throw new Error('Could not locate managed-session storage restore block in main.js');
  }
}

if (!source.includes('await browserSession.clearStorageData();')) {
  throw new Error('Managed-session partition reset patch was not applied');
}
if (!source.includes('const skipPortablePageStorage =')) {
  throw new Error('Netflix per-device storage guard was not applied');
}

fs.writeFileSync(mainPath, source);
console.log('Applied Netflix managed-session portability fix.');
