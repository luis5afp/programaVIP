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
