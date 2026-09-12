const loadingView = document.getElementById('loading-view');
const loginView = document.getElementById('login-view');
const clientView = document.getElementById('client-view');
const loginForm = document.getElementById('login-form');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const catalogError = document.getElementById('catalog-error');
const profilesGrid = document.getElementById('profiles-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('profile-search');
const refreshButton = document.getElementById('refresh-button');
const logoutButton = document.getElementById('logout-button');
const heartbeatTime = document.getElementById('heartbeat-time');
const serverState = document.getElementById('server-state');

let auth = null;
let catalog = null;
let query = '';

function show(view) {
  for (const element of [loadingView, loginView, clientView]) element.classList.add('hidden');
  view.classList.remove('hidden');
}

function setError(element, message) {
  if (!message) {
    element.textContent = '';
    element.classList.add('hidden');
    return;
  }
  element.textContent = message;
  element.classList.remove('hidden');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('es-PE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return '—';
  }
}

function profileLabel(profile) {
  return profile?.tags?.[0] || profile?.name || 'Perfil';
}

function domain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function renderAccount() {
  document.getElementById('client-name').textContent = auth?.client?.name || 'Cliente';
  document.getElementById('client-email').textContent = auth?.client?.email || '';
  document.getElementById('plan-name').textContent = catalog?.plan?.name || auth?.plan?.name || '—';
  document.getElementById('plan-expiry').textContent = `Vence ${formatDate(catalog?.expiresAt || auth?.subscription?.expiresAt)}`;
}

function badge(text, tone = '') {
  const span = document.createElement('span');
  span.className = `badge ${tone}`.trim();
  span.textContent = text;
  return span;
}

function renderProfiles() {
  profilesGrid.replaceChildren();
  const profiles = Array.isArray(catalog?.profiles) ? catalog.profiles : [];
  const normalizedQuery = normalize(query.trim());
  const filtered = normalizedQuery
    ? profiles.filter((profile) => normalize(`${profileLabel(profile)} ${profile.name || ''} ${profile.url || ''} ${(profile.tags || []).join(' ')}`).includes(normalizedQuery))
    : profiles;

  emptyState.classList.toggle('hidden', filtered.length !== 0);
  if (profiles.length > 0 && filtered.length === 0) {
    emptyState.querySelector('h3').textContent = 'No se encontraron perfiles';
    emptyState.querySelector('p').textContent = `No hay coincidencias para “${query.trim()}”.`;
  } else if (profiles.length === 0) {
    emptyState.querySelector('h3').textContent = 'No tienes perfiles asignados';
    emptyState.querySelector('p').textContent = 'Cuando el administrador te asigne un perfil aparecerá aquí automáticamente.';
  }

  for (const profile of filtered) {
    const card = document.createElement('article');
    card.className = 'profile-card';

    const image = document.createElement('div');
    image.className = 'profile-image';
    if (profile.imageUrl) {
      const img = document.createElement('img');
      img.src = profile.imageUrl;
      img.alt = '';
      image.appendChild(img);
    } else {
      image.textContent = '◎';
    }

    const body = document.createElement('div');
    body.className = 'profile-body';
    const title = document.createElement('h3');
    title.textContent = profileLabel(profile);
    const url = document.createElement('div');
    url.className = 'profile-domain';
    url.textContent = domain(profile.url);

    const badges = document.createElement('div');
    badges.className = 'badges';
    if (profile.sessionMode === 'managed-first-party') {
      badges.appendChild(badge(profile.sessionReady ? `Sesión lista · v${profile.sessionVersion || 0}` : 'Sesión no disponible', profile.sessionReady ? 'ok' : 'warn'));
    } else {
      badges.appendChild(badge('Login manual'));
    }
    if (profile.networkIdentity?.locked) {
      badges.appendChild(badge(profile.networkIdentity.publicIp ? `IP fija · ${profile.networkIdentity.publicIp}` : 'Proxy protegido', 'locked'));
    } else if (profile.managedConnection) {
      badges.appendChild(badge('Proxy asignado', 'locked'));
    } else {
      badges.appendChild(badge('Conexión directa'));
    }

    body.append(title, url, badges);

    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'open-button';
    const unavailable = profile.sessionMode === 'managed-first-party' && !profile.sessionReady;
    button.disabled = unavailable;
    button.textContent = unavailable ? 'No disponible' : 'Abrir';
    button.addEventListener('click', async () => {
      setError(catalogError, '');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Abriendo…';
      const result = await window.userflex.launchProfile(profile.id);
      if (!result?.ok) {
        setError(catalogError, result?.error?.message || 'No se pudo abrir el perfil.');
      }
      button.disabled = unavailable;
      button.textContent = original;
    });
    actions.appendChild(button);

    card.append(image, body, actions);
    profilesGrid.appendChild(card);
  }
}

function renderClient() {
  renderAccount();
  renderProfiles();
  show(clientView);
}

async function refreshCatalog() {
  refreshButton.disabled = true;
  setError(catalogError, '');
  const result = await window.userflex.catalog();
  refreshButton.disabled = false;
  if (!result?.ok) {
    setError(catalogError, result?.error?.message || 'No se pudo actualizar.');
    if (result?.error?.status === 401) show(loginView);
    return;
  }
  auth = result.auth || auth;
  catalog = result.catalog;
  renderClient();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError(loginError, '');
  loginButton.disabled = true;
  loginButton.textContent = 'Ingresando…';
  const result = await window.userflex.login({
    identifier: document.getElementById('identifier').value,
    password: document.getElementById('password').value,
  });
  loginButton.disabled = false;
  loginButton.textContent = 'Ingresar';
  if (!result?.ok) {
    setError(loginError, result?.error?.message || 'No se pudo iniciar sesión.');
    return;
  }
  document.getElementById('password').value = '';
  auth = result.auth;
  catalog = result.catalog;
  query = '';
  searchInput.value = '';
  renderClient();
});

searchInput.addEventListener('input', () => {
  query = searchInput.value;
  renderProfiles();
});

refreshButton.addEventListener('click', () => void refreshCatalog());

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await window.userflex.logout();
  logoutButton.disabled = false;
  auth = null;
  catalog = null;
  query = '';
  loginForm.reset();
  setError(loginError, '');
  show(loginView);
});

window.userflex.onHeartbeat((payload) => {
  serverState.textContent = payload?.active === false ? 'Servidor sin autorización' : 'Servidor conectado';
  serverState.classList.toggle('bad', payload?.active === false);
  heartbeatTime.textContent = `Última conexión ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
});

window.userflex.onAuthInvalidated((payload) => {
  auth = null;
  catalog = null;
  setError(loginError, payload?.message || 'Tu sesión ya no está activa.');
  show(loginView);
});

(async () => {
  const result = await window.userflex.bootstrap();
  if (result?.authenticated) {
    auth = result.auth;
    catalog = result.catalog;
    renderClient();
  } else {
    if (result?.error?.message) setError(loginError, result.error.message);
    show(loginView);
  }
})();
