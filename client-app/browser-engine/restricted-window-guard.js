// Route additional Edge windows back into the authorized profile's app mode.
// A Chromium --app window does not automatically make target=_blank/window.open
// children app windows. The original popup is closed and opened as another
// app window with the SAME --user-data-dir, preserving cookies/extensions.
//
// This guards userFLOW-created Edge sessions, not an adversary with Windows
// admin rights. Replacing a JS popup loses window.opener; OAuth flows which
// depend on postMessage to the opener may require an alternate redirect flow.
const HINT_TTL_MS = 8_000;
const EXPECTED_TTL_MS = 12_000;
const MAX_APP_WINDOWS = 12;

export function restrictedPopupUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function restrictedAppWindowArgs({ userDataDir, url, proxyRules = null }) {
  const destination = restrictedPopupUrl(url);
  if (!destination || !userDataDir) throw new Error('Destino no permitido para la ventana restringida.');
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--app=${destination}`,
  ];
  if (proxyRules) {
    args.push(`--proxy-server=${proxyRules}`, '--proxy-bypass-list=localhost;127.0.0.1;[::1]', '--disable-quic');
  }
  return args;
}

export async function startRestrictedWindowGuard({
  connectBrowser,
  debugPort,
  initialUrl,
  launchAppWindow,
  logger = console,
  settleMs = 120,
} = {}) {
  if (typeof connectBrowser !== 'function' || typeof launchAppWindow !== 'function') {
    throw new Error('El controlador de ventanas restringidas está incompleto.');
  }
  const homepage = restrictedPopupUrl(initialUrl);
  if (!homepage) throw new Error('El perfil necesita una página principal HTTP o HTTPS.');
  const browser = await connectBrowser(debugPort);
  let stopped = false;
  const initialTargets = new Set(browser.targets().filter((target) => target.type?.() === 'page'));
  const acceptedTargets = new WeakSet(initialTargets);
  const checked = new WeakSet();
  const processing = new WeakSet();
  const pageSessions = new Set();
  const targetSessions = new WeakMap();
  const activeAppTargets = new Set();
  const hintedPopups = [];
  const expectedAppPages = [];
  const tasks = new Set();
  let routedCount = 0;

  const logWarning = (message) => logger.warn?.('userFLOW restricted windows:', message);

  function recent(array, now = Date.now()) {
    for (let index = array.length - 1; index >= 0; index -= 1) {
      if (array[index].expiresAt <= now) array.splice(index, 1);
    }
  }

  function hintFor(target, opener) {
    recent(hintedPopups);
    const url = restrictedPopupUrl(target.url?.());
    let index = hintedPopups.findIndex((hint) => hint.source === opener
      && (url === null || url === hint.url));
    if (index < 0 && url) index = hintedPopups.findIndex((hint) => hint.url === url);
    if (index < 0) return null;
    return hintedPopups.splice(index, 1)[0];
  }

  function markExpected(url) {
    recent(expectedAppPages);
    expectedAppPages.push({ url, expiresAt: Date.now() + EXPECTED_TTL_MS });
  }

  function claimExpected(url) {
    recent(expectedAppPages);
    const index = expectedAppPages.findIndex((item) => item.url === url);
    if (index < 0) return false;
    expectedAppPages.splice(index, 1);
    return true;
  }

  async function attachWindowOpenEvents(target) {
    if (stopped || target.type?.() !== 'page' || checked.has(target)) return;
    checked.add(target);
    try {
      const session = await target.createCDPSession();
      if (stopped) {
        await session.detach().catch(() => null);
        return;
      }
      pageSessions.add(session);
      targetSessions.set(target, session);
      session.on('Page.windowOpen', (event) => {
        const destination = restrictedPopupUrl(event?.url);
        if (!destination || stopped) return;
        recent(hintedPopups);
        hintedPopups.push({
          source: target,
          url: destination,
          expiresAt: Date.now() + HINT_TTL_MS,
        });
      });
      await session.send('Page.enable');
    } catch {
      // If a page already exited before attachment, handle its next target.
    }
  }

  async function closeNativeTarget(target) {
    try {
      const page = await target.page?.();
      if (page) {
        await page.close({ runBeforeUnload: false });
        return true;
      }
    } catch {}
    try {
      const targetId = target._targetId || target._targetInfo?.targetId;
      if (targetId) {
        const session = await browser.createBrowserCDPSession();
        try {
          await session.send('Target.closeTarget', { targetId });
          return true;
        } finally {
          await session.detach().catch(() => null);
        }
      }
    } catch {}
    return false;
  }

  async function examineNewPage(target) {
    if (stopped || processing.has(target) || acceptedTargets.has(target)
        || target.type?.() !== 'page') return;
    processing.add(target);
    try {
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      if (stopped) return;

      const opener = target.opener?.() || null;
      const destination = restrictedPopupUrl(target.url?.());
      // The second --app command creates a page in the same Chromium profile.
      // Do not close/relaunch it or a loop would occur.
      if (destination && claimExpected(destination) && !opener) {
        acceptedTargets.add(target);
        activeAppTargets.add(target);
        await attachWindowOpenEvents(target);
        return;
      }

      const hint = hintFor(target, opener);
      if (!opener && !hint && !destination) {
        // Normal Ctrl+N/Ctrl+T windows start blank. Prevent an unrestricted
        // Edge window remaining in place by routing it to the app home page.
        // An app window launched by us can be momentarily blank too; wait
        // briefly for its actual target URL before making that decision.
        const rawUrl = String(target.url?.() || '').trim().toLowerCase();
        if (expectedAppPages.length && (rawUrl === '' || rawUrl === 'about:blank')) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (stopped) return;
          const arrived = restrictedPopupUrl(target.url?.());
          if (arrived && claimExpected(arrived)) {
            acceptedTargets.add(target);
            activeAppTargets.add(target);
            await attachWindowOpenEvents(target);
            return;
          }
          if (!arrived) {
            // Edge can register the new --app page before it receives its
            // destination. Claim the matching pending launch rather than
            // closing a controlled window and launching it repeatedly.
            const pending = expectedAppPages.shift();
            if (pending) {
              acceptedTargets.add(target);
              activeAppTargets.add(target);
              await attachWindowOpenEvents(target);
              return;
            }
          }
        }
      }

      // New HTTP/HTTPS tab or pop-up from a managed page: keep it inside
      // restricted app windows. Never redirect chrome://, edge:// or
      // chrome-extension:// to an app window.
      const url = destination || hint?.url || homepage;
      if (!await closeNativeTarget(target)) {
        logWarning('No se pudo cerrar una ventana adicional del navegador.');
        return;
      }
      if (stopped) return;
      recent(expectedAppPages);
      if (activeAppTargets.size + expectedAppPages.length >= MAX_APP_WINDOWS) {
        logWarning('Se alcanzó el límite de ventanas adicionales de este perfil.');
        return;
      }
      markExpected(url);
      try {
        await launchAppWindow(url);
        routedCount += 1;
      } catch {
        logWarning('No se pudo abrir una ventana adicional en modo restringido.');
      }
    } finally {
      processing.delete(target);
    }
  }

  const onTargetCreated = (target) => {
    if (stopped || target.type?.() !== 'page') return;
    const task = examineNewPage(target);
    tasks.add(task);
    void task.catch(() => logWarning('No se pudo controlar una nueva ventana.'))
      .finally(() => tasks.delete(task));
  };

  for (const target of initialTargets) await attachWindowOpenEvents(target);
  const onTargetDestroyed = (target) => {
    activeAppTargets.delete(target);
    const session = targetSessions.get(target);
    if (session) {
      pageSessions.delete(session);
      void session.detach().catch(() => null);
    }
  };
  browser.on('targetcreated', onTargetCreated);
  browser.on('targetdestroyed', onTargetDestroyed);

  return {
    get routedCount() { return routedCount; },
    async close() {
      if (stopped) return;
      stopped = true;
      browser.off('targetcreated', onTargetCreated);
      browser.off('targetdestroyed', onTargetDestroyed);
      await Promise.allSettled(Array.from(tasks));
      await Promise.allSettled(Array.from(pageSessions, (session) => session.detach()));
      await browser.disconnect().catch(() => null);
    },
  };
}


// Event-driven guard for native Edge tabs. Unlike the legacy --app router,
// never destroys valid popup targets or their window.opener relationships.
// Native Browser Guard consolidates additional *normal windows* by moving
// their tabs into the first Edge normal window, with no network/API polling.
const RESTRICTED_INTERNAL_PAGE = /^(?:edge|chrome):\/(?:\/)(?:extensions|settings|flags|policy|inspect|password-manager)(?:\/|$|[?#])/i;
const DEVTOOLS_PAGE = /^devtools:\/\//i;

export async function startRestrictedTabbedGuard({
  connectBrowser,
  debugPort,
  logger = console,
  onIntegrityLost = null,
} = {}) {
  if (typeof connectBrowser !== 'function') {
    throw new Error('Falta el canal de protección de pestañas.');
  }
  const browser = await connectBrowser(debugPort);
  let stopped = false;
  let warned = false;
  const pending = new Set();
  const inspected = new WeakSet();
  const warn = (message) => logger.warn?.('userFLOW restricted tabbed Edge:', message);

  let guardWorker = null;
  let guardSession = null;
  async function adoptBrowserGuardWorker() {
    // Keeping a CDP debugging session attached prevents the Manifest V3
    // service worker from suspending as idle on supported Chromium versions.
    // Its destruction then signals disabled, removed or crashed protection.
    for (const target of browser.targets()) {
      if (target.type?.() !== 'service_worker'
        || !/chrome-extension:\/\/[^/]+\/background\.js(?:$|\?)/.test(target.url?.() || '')) continue;
      let session = null;
      try {
        session = await target.createCDPSession();
        await session.send('Runtime.enable');
        const response = await session.send('Runtime.evaluate', {
          expression: 'chrome.runtime.getManifest().name',
          returnByValue: true,
        });
        if (response?.result?.value === 'userFLEX Browser Guard') {
          guardWorker = target;
          guardSession = session;
          return;
        }
      } catch { /* Another extension's worker may be unavailable. */ }
      await session?.detach().catch(() => null);
    }
    throw new Error('No se pudo conectar con userFLEX Browser Guard. Perfil bloqueado.');
  }

  async function blockUnsafeTarget(target) {
    if (stopped || !target || inspected.has(target)) return;
    const url = String(target.url?.() || '');
    if (!RESTRICTED_INTERNAL_PAGE.test(url) && !DEVTOOLS_PAGE.test(url)) return;
    inspected.add(target);
    try {
      const page = await target.page?.();
      if (page) await page.close({runBeforeUnload:false});
      else {
        const targetId = target._targetId || target._targetInfo?.targetId;
        if (!targetId) throw new Error('No hay ID de objetivo.');
        const session = await browser.createBrowserCDPSession();
        try { await session.send('Target.closeTarget', {targetId}); }
        finally { await session.detach().catch(() => null); }
      }
    } catch (error) {
      warn('No se pudo bloquear una página interna de Edge.');
      if (typeof onIntegrityLost === 'function') void onIntegrityLost(error);
    }
  }

  const checkTarget = (target) => {
    const job = blockUnsafeTarget(target);
    pending.add(job);
    void job.catch(() => warn('No se pudo inspeccionar la navegación protegida.'))
      .finally(() => pending.delete(job));
  };
  const workerDestroyed = (target) => {
    if (stopped || target !== guardWorker || warned) return;
    warned = true;
    warn('Se perdió Browser Guard; cerrando el perfil restringido.');
    if (typeof onIntegrityLost === 'function') {
      void Promise.resolve(onIntegrityLost(new Error('BROWSER_GUARD_DISCONNECTED')))
        .catch(() => warn('No se pudo cerrar el perfil tras perder Browser Guard.'));
    }
  };

  try {
    await adoptBrowserGuardWorker();
    browser.on('targetcreated', checkTarget);
    browser.on('targetchanged', checkTarget);
    browser.on('targetdestroyed', workerDestroyed);
    for (const target of browser.targets()) checkTarget(target);
  } catch (error) {
    await guardSession?.detach().catch(() => null);
    await browser.disconnect().catch(() => null);
    throw error;
  }
  return {
    async close() {
      if (stopped) return;
      stopped = true;
      browser.off('targetcreated', checkTarget);
      browser.off('targetchanged', checkTarget);
      browser.off('targetdestroyed', workerDestroyed);
      await Promise.allSettled([...pending]);
      await guardSession?.detach().catch(() => null);
      await browser.disconnect().catch(() => null);
    },
  };
}
