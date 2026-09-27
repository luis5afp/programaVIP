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

  if (globalThis.USERFLEX_STREAMING_DOM !== true) return;

  const TEXT_PATTERN = /(?:no\s+forma\s+parte[^.!?]{0,120}(?:hogar|household)|not\s+part[^.!?]{0,120}(?:hogar|household)|ver\s+temporalmente|watch\s+temporarily|verificaci[oó]n[^.!?]{0,120}(?:hogar|dispositivo|device|household)|verification[^.!?]{0,120}(?:hogar|dispositivo|device|household)|(?:dispositivo|device)[^.!?]{0,100}(?:hogar|household))/i;
  const DEFAULT_SELECTORS = [
    '[data-userflex-streaming-overlay]',
    '[data-userflex-test="streaming-restriction"]',
    '.userflex-streaming-overlay',
    '.userflex-streaming-test-restriction',
  ];

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const declaredSelectors = () => String(
    document.querySelector('meta[name="userflex-streaming-overlay-selectors"]')?.getAttribute('content') || ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const hide = (element) => {
    if (!(element instanceof HTMLElement)) return false;
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

  const roots = () => {
    const found = [document];
    const visit = (root) => {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('*')); } catch { return; }
      for (const node of nodes) {
        if (node.shadowRoot) {
          found.push(node.shadowRoot);
          visit(node.shadowRoot);
        }
      }
    };
    visit(document);
    return found;
  };

  const dialogLike = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const role = String(element.getAttribute('role') || '').toLowerCase();
    const modal = String(element.getAttribute('aria-modal') || '').toLowerCase() === 'true';
    const cls = String(element.className || '').toLowerCase();
    if (role === 'dialog' || modal || /modal|overlay|popup|dialog|interstitial/.test(cls)) return true;

    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const fixed = style.position === 'fixed' || style.position === 'sticky';
      const large = rect.width >= innerWidth * 0.45 && rect.height >= innerHeight * 0.25;
      const highLayer = Number.parseInt(style.zIndex || '0', 10) >= 10;
      return fixed && large && highLayer;
    } catch {
      return false;
    }
  };

  const nearestOverlay = (start) => {
    let node = start instanceof Element ? start : start?.parentElement || null;
    let fallback = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (!fallback && node instanceof HTMLElement) fallback = node;
      if (dialogLike(node)) return node;
    }
    return fallback;
  };

  const explicitCandidates = (root) => {
    const selectors = [...DEFAULT_SELECTORS, ...declaredSelectors()];
    const out = [];
    for (const selector of selectors) {
      try { out.push(...root.querySelectorAll(selector)); } catch {}
    }
    return out;
  };

  const textCandidates = (root) => {
    const out = [];
    let walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    } catch {
      return out;
    }

    let current;
    let inspected = 0;
    while ((current = walker.nextNode()) && inspected < 12000) {
      inspected += 1;
      const text = normalizeText(current.nodeValue);
      if (!text || !TEXT_PATTERN.test(text)) continue;
      const overlay = nearestOverlay(current);
      if (overlay) out.push(overlay);
    }
    return out;
  };

  const process = () => {
    const seen = new Set();
    let matched = 0;
    let hidden = 0;

    for (const root of roots()) {
      const candidates = [...explicitCandidates(root), ...textCandidates(root)];
      for (const element of candidates) {
        if (!(element instanceof HTMLElement) || seen.has(element)) continue;
        seen.add(element);
        matched += 1;
        if (hide(element)) hidden += 1;
      }
    }

    try {
      document.documentElement.dataset.userflexStreamingDom = 'active';
      document.documentElement.dataset.userflexStreamingMatched = String(matched);
      document.documentElement.dataset.userflexStreamingHidden = String(hidden);
    } catch {}

    return { enabled: true, overlays: matched, hidden };
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      process();
    });
  };

  const start = () => {
    process();

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'role', 'aria-modal', 'data-userflex-streaming-overlay'],
    });

    const timer = setInterval(process, 750);
    addEventListener('pagehide', () => clearInterval(timer), { once: true });
    addEventListener('pageshow', process);
  };

  if (document.documentElement) start();
  else addEventListener('DOMContentLoaded', start, { once: true });
})();
