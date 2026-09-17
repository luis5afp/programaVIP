const { ipcRenderer } = require('electron');

let credentials = null;
let saved = false;

function visible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function tryAutofill() {
  if (!credentials || location.origin !== credentials.allowedOrigin) return;
  const inputs = Array.from(document.querySelectorAll('input')).filter((input) => visible(input) && !input.disabled && !input.readOnly);
  const password = inputs.find((input) => input.type === 'password');
  const username = inputs.find((input) => {
    const hint = `${input.type} ${input.name} ${input.id} ${input.autocomplete} ${input.placeholder}`.toLowerCase();
    return input.type === 'email' || /email|e-mail|user|usuario|login|account/.test(hint);
  });
  if (username && !username.value) setNativeValue(username, credentials.username);
  if (password && !password.value) setNativeValue(password, credentials.password);
}

function netflixCaptureProblem() {
  const host = String(location.hostname || '').toLowerCase();
  const isNetflix = host === 'netflix.com' || host.endsWith('.netflix.com');
  if (!isNetflix) return null;

  const pathname = String(location.pathname || '').toLowerCase();
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return 'Netflix todavía no tiene la cuenta abierta. Completa el inicio de sesión antes de guardar.';
  }

  const text = String(document.body?.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es');
  const errorSignals = [
    'sentimos la interrupción',
    'tenemos problemas con tu solicitud',
    'código de error',
    'pardon the interruption',
    "we're having trouble",
    'error code',
  ];
  if (errorSignals.some((signal) => text.includes(signal))) {
    return 'Netflix está mostrando una página de error. Pulsa Inicio de Netflix, confirma que la cuenta esté abierta y guarda la sesión desde la pantalla normal de Netflix.';
  }

  return null;
}

function savedMessage(result) {
  const count = Number(result?.cookieCount || 0);
  const cookieText = count > 0 ? `${count} cookies verificadas` : 'cookies verificadas';
  const ipText = result?.publicIp ? ` IP de salida: ${result.publicIp}.` : '';
  return `Sesión guardada con ${cookieText}.${ipText}`;
}

function installOverlay() {
  if (document.getElementById('userflex-session-overlay')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'userflex-session-overlay';
  wrapper.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#0f172a;color:white;border:1px solid #334155;border-radius:14px;padding:12px 14px;box-shadow:0 12px 35px rgba(0,0,0,.35);font:13px system-ui;max-width:320px';
  wrapper.innerHTML = '<div style="font-weight:800;margin-bottom:8px">userFLEX · Captura de sesión</div><div id="userflex-session-message" style="opacity:.8;margin-bottom:10px">Completa el acceso, 2FA o CAPTCHA si aparece. Cuando la cuenta esté abierta y la web esté funcionando normalmente, guarda la sesión.</div><button id="userflex-session-save" style="border:0;border-radius:9px;padding:9px 13px;font-weight:800;cursor:pointer">Guardar sesión</button>';
  document.documentElement.appendChild(wrapper);
  const button = wrapper.querySelector('#userflex-session-save');
  const message = wrapper.querySelector('#userflex-session-message');
  button?.addEventListener('click', async () => {
    if (saved) return;
    const problem = netflixCaptureProblem();
    if (problem) {
      message.textContent = problem;
      button.disabled = false;
      button.textContent = 'Guardar sesión';
      return;
    }

    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      const result = await ipcRenderer.invoke('userflex:save-session');
      saved = true;
      const count = Number(result?.cookieCount || 0);
      button.textContent = count > 0 ? `Guardada · v${result.version} · ${count} cookies` : `Guardada · v${result.version}`;
      message.textContent = savedMessage(result);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Guardar sesión';
      message.textContent = error instanceof Error ? error.message : String(error);
    }
  });
}

ipcRenderer.on('userflex:credentials', (_event, payload) => {
  credentials = payload;
  tryAutofill();
  window.setTimeout(tryAutofill, 500);
  window.setTimeout(tryAutofill, 1500);
});

ipcRenderer.on('userflex:saved', (_event, result) => {
  const message = document.getElementById('userflex-session-message');
  if (message) message.textContent = savedMessage(result);
});

window.addEventListener('DOMContentLoaded', () => {
  installOverlay();
  tryAutofill();
  const observer = new MutationObserver(() => tryAutofill());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
});
