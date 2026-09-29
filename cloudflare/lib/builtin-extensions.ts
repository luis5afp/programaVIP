import { strToU8, zipSync } from 'fflate';

export type BundledExtensionDefinition = {
  name: string;
  description: string;
  version: string;
  packageBytes: Uint8Array;
};

const COMMON_BLOCKED_PREFIXES = [
  'chrome://extensions',
  'chrome://settings',
  'edge://extensions',
  'edge://settings',
  'https://chromewebstore.google.com/',
  'https://developer.chrome.com/',
];

const COMMON_SENSITIVE_URLS = [
  'https://www.uptodate.com/contents/search?myAccount=true',
  'https://curso.felipevergara.co/settings/account',
  'https://www.skool.com/settings?t=account',
  'https://www.freepik.es/user/my-subscriptions',
  'https://elevenlabs.io/app/subscription',
  'https://www.luqueacademy.com/settings/account',
  'https://escuela.yourunads.es/settings/account',
];

const backgroundScript = String.raw`
const BLOCKED_PREFIXES = ${JSON.stringify(COMMON_BLOCKED_PREFIXES)};
const SENSITIVE_URLS = ${JSON.stringify(COMMON_SENSITIVE_URLS)};

function shouldBlock(rawUrl) {
  const url = String(rawUrl || '');
  const lower = url.toLowerCase();
  if (!lower) return false;
  if (BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))) return true;
  return SENSITIVE_URLS.some((value) => lower.includes(String(value).toLowerCase()));
}

async function moveAway(tabId) {
  if (!Number.isInteger(tabId)) return;
  try { await chrome.tabs.update(tabId, { url: 'chrome://newtab/' }); } catch {
    try { await chrome.tabs.update(tabId, { url: 'about:blank' }); } catch {}
  }
}

const PROTECTED_NAMES = new Set(['ex1', 'ex2', 'userFLEX Browser Guard', 'Toolspoint-Extension']);
const protectedIds = new Set();
let closingForTamper = false;

async function snapshotProtectedExtensions() {
  try {
    const items = await chrome.management.getAll();
    for (const item of items) {
      if (!PROTECTED_NAMES.has(String(item?.name || '')) || item?.enabled === false || !item?.id) continue;
      protectedIds.add(String(item.id));
    }
  } catch {}
}

async function closeManagedProfile() {
  if (closingForTamper) return;
  closingForTamper = true;
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    await Promise.all(
      (Array.isArray(windows) ? windows : [])
        .map((windowInfo) => Number(windowInfo?.id))
        .filter(Number.isInteger)
        .map((windowId) => chrome.windows.remove(windowId).catch(() => null)),
    );
  } catch {}
}

chrome.management.onDisabled.addListener((item) => {
  const id = String(item?.id || '');
  if (!id || !protectedIds.has(id)) return;
  void (async () => {
    await chrome.management.setEnabled(id, true).catch(() => null);
    await closeManagedProfile();
  })();
});

chrome.management.onInstalled.addListener(() => void snapshotProtectedExtensions());

chrome.management.onUninstalled.addListener((extensionId) => {
  const id = String(extensionId || '');
  if (!id || !protectedIds.has(id)) return;
  void closeManagedProfile();
});

if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => void closeManagedProfile());
}
if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => void closeManagedProfile());
}
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(() => void closeManagedProfile());
}

chrome.runtime.onInstalled.addListener(() => {
  try { chrome.alarms.create('userflow-extension-keepalive', { periodInMinutes: 1 }); } catch {}
  void snapshotProtectedExtensions();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== 'userflow-extension-keepalive') return;
  try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch {}
  void snapshotProtectedExtensions();
});

void snapshotProtectedExtensions();

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || !shouldBlock(details.url)) return;
  void moveAway(details.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  if (!shouldBlock(tab?.url)) return;
  void moveAway(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!shouldBlock(tab?.url)) return;
  void moveAway(tab.id);
});

`;

const ex1ContentScript = String.raw`
(() => {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  addEventListener('keydown', (event) => {
    const key = String(event.key || '').toUpperCase();
    if (key === 'F12' || (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(key))) stop(event);
  }, true);
  addEventListener('contextmenu', stop, true);

  const host = String(location.hostname || '').toLowerCase();
  const skipPrivacyMask = host === 'accounts.google.com' || host.endsWith('.accounts.google.com') || host.includes('yourunads.es');
  const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const recoveryPattern = /(forgot|reset|recover|lost|find|remember|retrieve|remind|recup|zabor|비밀번호찾기|パスワード再設定|忘记|senha|contraseña|motdepasse|reimposta|восстанов)/i;
  const passwordPattern = /(pass|pwd|pw|motdepasse|contraseña|senha|парол|密码|パスワード|암호)/i;
  let timer = null;

  const maskEmail = (value) => String(value || '').replace(emailPattern, (email) => {
    const at = email.indexOf('@');
    if (at <= 0) return email;
    return email[0] + '*'.repeat(Math.max(1, at - 1)) + email.slice(at);
  });

  const scan = (root = document) => {
    if (!(root instanceof Document || root instanceof Element)) return;

    if (!skipPrivacyMask) {
      let seen = 0;
      const nodes = root.querySelectorAll('a,button,label,span,p,div,input,textarea');
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.closest('script,style,noscript,video,audio')) continue;
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          if ((node.readOnly || node.disabled) && emailPattern.test(String(node.value || ''))) {
            node.value = maskEmail(node.value);
          }
          emailPattern.lastIndex = 0;
        } else if (node.childElementCount === 0) {
          const text = String(node.textContent || '');
          if (emailPattern.test(text)) node.textContent = maskEmail(text);
          emailPattern.lastIndex = 0;
        }
        seen += 1;
        if (seen >= 300) break;
      }
    }

    let checked = 0;
    for (const node of root.querySelectorAll('a,button')) {
      if (!(node instanceof HTMLElement)) continue;
      const combined = [
        node.innerText,
        node.textContent,
        node.getAttribute('title'),
        node.getAttribute('aria-label'),
        node.getAttribute('href'),
        node.id,
        node.className,
      ].map((value) => String(value || '')).join(' ');
      if (passwordPattern.test(combined) && recoveryPattern.test(combined)) {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        node.setAttribute('aria-hidden', 'true');
      }
      checked += 1;
      if (checked >= 150) break;
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const run = () => scan(document);
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 900 });
      else run();
    }, 300);
  };

  const start = () => {
    schedule();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes?.length)) schedule();
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    const fallback = setInterval(schedule, 15000);
    addEventListener('pagehide', () => {
      observer.disconnect();
      clearInterval(fallback);
      if (timer) clearTimeout(timer);
      timer = null;
    }, { once: true });
  };

  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start, { once: true });
})();
`;

const ex2ContentScript = String.raw`
(() => {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  addEventListener('keydown', (event) => {
    const key = String(event.key || '').toUpperCase();
    if (key === 'F12' || (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(key))) stop(event);
  }, true);

  addEventListener('contextmenu', stop, true);
})();
`;

function manifest(name: string, version: string, description: string, extraPermissions: string[] = []) {
  return {
    manifest_version: 3,
    name,
    version,
    description,
    permissions: ['tabs', 'webNavigation', 'management', 'alarms', ...extraPermissions],
    background: { service_worker: 'backgroundScript.js' },
    content_scripts: [{
      matches: ['<all_urls>'],
      js: ['contentScript.js'],
      run_at: 'document_start',
    }],
    host_permissions: ['<all_urls>'],
  };
}

function packageZip(manifestValue: object, contentScript: string) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifestValue, null, 2)),
    'backgroundScript.js': strToU8(backgroundScript),
    'contentScript.js': strToU8(contentScript),
    'USERFLOW_README.txt': strToU8(
      'Paquete integrado por userFLEX. No depende de kaizzen.org y no envía historial ni datos de navegación a terceros.\n',
    ),
  }, { level: 9, mtime: new Date('2026-01-01T00:00:00.000Z') });
}

export function bundledExtensions(): BundledExtensionDefinition[] {
  const ex1Version = '1.7';
  const ex2Version = '1.6';
  const ex1Description = 'Protección de sesión y privacidad integrada para userFLOW, sin dependencias externas.';
  const ex2Description = 'Protección ligera del navegador integrada para userFLOW, sin dependencias externas.';

  return [
    {
      name: 'ex1',
      description: ex1Description,
      version: ex1Version,
      packageBytes: packageZip(
        manifest('ex1', ex1Version, ex1Description, ['storage']),
        ex1ContentScript,
      ),
    },
    {
      name: 'ex2',
      description: ex2Description,
      version: ex2Version,
      packageBytes: packageZip(
        manifest('ex2', ex2Version, ex2Description),
        ex2ContentScript,
      ),
    },
  ];
}
