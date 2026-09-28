(() => {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  addEventListener('keydown', (event) => {
    const key = String(event.key || '').toUpperCase();
    const devtools = key === 'F12' || (event.ctrlKey && event.shiftKey && ['I', 'J', 'C'].includes(key));
    if (devtools) stop(event);
  }, true);

  addEventListener('contextmenu', stop, true);

  // Core userFLEX content rules. These replace the need for a separate remote
  // blocker extension: the Admin stores CSS selectors in Neon, the Worker
  // delivers only the rules for this profile, and Browser Guard applies them
  // locally. Work is domain-scoped, debounced and structural-only to avoid
  // repeating the heavy DOM scans that previously caused lag on large SPAs.
  const managedRules = (Array.isArray(globalThis.USERFLEX_CONTENT_RULES)
    ? globalThis.USERFLEX_CONTENT_RULES
    : [])
    .slice(0, 150)
    .map((rule) => ({
      id: String(rule?.id || '').slice(0, 64),
      domain: String(rule?.domain || '').trim().toLowerCase().replace(/^\*\./, ''),
      selector: String(rule?.selector || '').trim().slice(0, 1000),
      action: 'hide',
    }))
    .filter((rule) => rule.domain && rule.selector);

  const currentHost = String(location.hostname || '').toLowerCase();
  const contentRules = managedRules.filter((rule) =>
    rule.domain === '*'
      || currentHost === rule.domain
      || currentHost.endsWith(`.${rule.domain}`));

  if (contentRules.length) {
    const hideByRule = (element, ruleId) => {
      if (!(element instanceof HTMLElement)) return false;
      const markerName = 'userflexContentRule';
      const current = String(element.dataset?.[markerName] || '');
      if (current.split(',').includes(ruleId)) return false;
      try {
        element.style.setProperty('display', 'none', 'important');
        element.style.setProperty('visibility', 'hidden', 'important');
        element.style.setProperty('pointer-events', 'none', 'important');
        element.setAttribute('aria-hidden', 'true');
        element.dataset[markerName] = current
          ? `${current},${ruleId}`.slice(0, 512)
          : ruleId;
        return true;
      } catch {
        return false;
      }
    };

    const applyContentRules = () => {
      let matched = 0;
      let hidden = 0;
      for (const rule of contentRules) {
        let nodes = [];
        try { nodes = document.querySelectorAll(rule.selector); } catch { continue; }
        let perRule = 0;
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue;
          matched += 1;
          if (hideByRule(node, rule.id || 'rule')) hidden += 1;
          perRule += 1;
          if (perRule >= 100 || matched >= 500) break;
        }
        if (matched >= 500) break;
      }
      try {
        document.documentElement.dataset.userflexContentRules = String(contentRules.length);
        document.documentElement.dataset.userflexContentMatched = String(matched);
        document.documentElement.dataset.userflexContentHidden = String(hidden);
      } catch {}
    };

    let managedTimer = null;
    const scheduleContentRules = () => {
      if (managedTimer) return;
      managedTimer = setTimeout(() => {
        managedTimer = null;
        const run = () => applyContentRules();
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 900 });
        else run();
      }, 280);
    };

    const startManagedRules = () => {
      scheduleContentRules();
      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.addedNodes?.length)) scheduleContentRules();
      });
      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
      });
      const fallbackTimer = setInterval(scheduleContentRules, 20000);
      addEventListener('pagehide', () => {
        observer.disconnect();
        clearInterval(fallbackTimer);
        if (managedTimer) clearTimeout(managedTimer);
        managedTimer = null;
      }, { once: true });
      addEventListener('pageshow', scheduleContentRules);
    };

    if (document.documentElement) startManagedRules();
    else addEventListener('DOMContentLoaded', startManagedRules, { once: true });
  }

  // IMPORTANT: this helper is intentionally opt-in per profile. Broad DOM
  // scanning on every mutation can freeze large SPAs such as editors and AI
  // tools. strategy.js sets this only for profiles that explicitly request it.
  if (globalThis.USERFLEX_STREAMING_DOM !== true) return;

  const TEXT_PATTERN = /(?:no\s+forma\s+parte[^.!?]{0,120}(?:hogar|household)|not\s+part[^.!?]{0,120}(?:hogar|household)|ver\s+temporalmente|watch\s+temporarily|verificaci[oó]n[^.!?]{0,120}(?:hogar|dispositivo|device|household)|verification[^.!?]{0,120}(?:hogar|dispositivo|device|household)|(?:dispositivo|device)[^.!?]{0,100}(?:hogar|household))/i;
  const DEFAULT_SELECTORS = [
    '[data-userflex-streaming-overlay]',
    '[data-userflex-test="streaming-restriction"]',
    '.userflex-streaming-overlay',
    '.userflex-streaming-test-restriction',
  ];
  const DIALOG_SELECTORS = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="overlay" i]',
    '[class*="dialog" i]',
    '[class*="interstitial" i]',
  ];

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const declaredSelectors = () => String(
    document.querySelector('meta[name="userflex-streaming-overlay-selectors"]')?.getAttribute('content') || ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);

  const hide = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.dataset.userflexStreamingHidden === '1') return false;
    try {
      element.dataset.userflexStreamingHidden = '1';
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('opacity', '0', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
      element.setAttribute('aria-hidden', 'true');
      return true;
    } catch {
      return false;
    }
  };

  const collect = (selectors, limit = 250) => {
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = document.querySelectorAll(selector); } catch { continue; }
      for (const node of nodes) {
        if (!(node instanceof HTMLElement) || seen.has(node)) continue;
        seen.add(node);
        out.push(node);
        if (out.length >= limit) return out;
      }
    }
    return out;
  };

  const process = () => {
    let matched = 0;
    let hidden = 0;

    const explicit = collect([...DEFAULT_SELECTORS, ...declaredSelectors()], 100);
    for (const element of explicit) {
      matched += 1;
      if (hide(element)) hidden += 1;
    }

    // Text matching is restricted to dialog-like containers. Do not walk every
    // text node or every shadow root; that was the source of renderer stalls.
    const dialogs = collect(DIALOG_SELECTORS, 200);
    for (const element of dialogs) {
      if (element.dataset.userflexStreamingHidden === '1') continue;
      const text = normalizeText(element.innerText || element.textContent || '').slice(0, 5000);
      if (!text || !TEXT_PATTERN.test(text)) continue;
      matched += 1;
      if (hide(element)) hidden += 1;
    }

    try {
      document.documentElement.dataset.userflexStreamingDom = 'active';
      document.documentElement.dataset.userflexStreamingMatched = String(matched);
      document.documentElement.dataset.userflexStreamingHidden = String(hidden);
    } catch {}

    return { enabled: true, overlays: matched, hidden };
  };

  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const run = () => process();
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
      else run();
    }, 250);
  };

  const start = () => {
    schedule();

    // Observe structural changes only. Watching style/class while this script
    // itself edits style caused a self-triggering mutation loop.
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes?.length)) schedule();
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });

    // Low-frequency fallback for frameworks that recycle existing nodes.
    const fallbackTimer = setInterval(schedule, 12000);
    addEventListener('pagehide', () => {
      observer.disconnect();
      clearInterval(fallbackTimer);
      if (timer) clearTimeout(timer);
      timer = null;
    }, { once: true });
    addEventListener('pageshow', schedule);
  };

  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start, { once: true });
})();
