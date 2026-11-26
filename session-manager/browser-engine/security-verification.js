// Read-only recognition of a pending security prompt. Never interact with it.
// Self-contained so Puppeteer can evaluate the function in the page.
export function securityVerificationState(doc = document) {
  try {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = doc.defaultView.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const frames = Array.from(doc.querySelectorAll('iframe'));
    if (frames.some(frame => visible(frame) && /challenges\.cloudflare\.com|\/turnstile\/|cloudflare|challenge/i.test(
      String(frame.getAttribute('src') || '') + ' ' + String(frame.getAttribute('title') || '')
    ))) return 'pending';
    if (Array.from(doc.querySelectorAll('.cf-turnstile,[data-sitekey][data-callback],[class*="turnstile"]')).some(visible)) return 'pending';
    const text = String(doc.body?.innerText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
    if (/verifi(?:que|ca|cando) que (?:es|eres|sea) (?:un )?ser humano|verificando que eres humano|verificacion fallo|verification failed|verify (?:that )?you are (?:a )?human|checking your browser|comprobando tu navegador/.test(text)) return 'pending';
    return doc.body ? 'not-detected' : 'unknown';
  } catch { return 'unknown'; }
}
