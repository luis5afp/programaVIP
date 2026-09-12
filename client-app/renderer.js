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
const subscriptionStatus = document.getElementById('subscription-status');
const categoryFilters = document.getElementById('category-filters');

let auth = null;
let catalog = null;
let query = '';
let category = 'all';
const launchingProfiles = new Set();

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
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString('es-PE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return null;
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

function profileSearchText(profile) {
  return normalize([
    profileLabel(profile),
    profile?.name,
    profile?.url,
    profile?.platform,
    ...(Array.isArray(profile?.tags) ? profile.tags : []),
  ].filter(Boolean).join(' '));
}

function profileCategories(profile) {
  const text = profileSearchText(profile);
  const result = new Set(['all']);
  const addWhen = (name, words) => {
    if (words.some((word) => text.includes(word))) result.add(name);
  };

  addWhen('chat', ['chat', 'chatgpt', 'claude', 'gemini', 'perplexity', 'copilot', 'deepseek']);
  addWhen('image', ['image', 'imagen', 'canva', 'leonardo', 'midjourney', 'ideogram', 'flux']);
  addWhen('video', ['video', 'digen', 'hailuo', 'runway', 'kling', 'sora', 'veo']);
  addWhen('audio', ['audio', 'voice', 'voz', 'voces', 'suno', 'udio', 'eleven', 'music', 'musica']);
  addWhen('pro', [' pro', 'pro ', 'plus', 'ultimate', 'premium', 'unlimited', 'ilimitado']);
  return result;
}

function renderAccount() {
  document.getElementById('client-name').textContent = auth?.client?.name || 'Cliente';
  const planName = catalog?.plan?.name || auth?.plan?.name || 'Plan activo';
  const expiry = formatDate(catalog?.expiresAt || auth?.subscription?.expiresAt);
  subscriptionStatus.textContent = expiry ? `${planName} · vence ${expiry}` : `${planName} · suscripción activa`;
}

function networkLabel(profile) {
  if (profile?.networkIdentity?.locked) {
    return profile.networkIdentity.publicIp ? `IP fija ${profile.networkIdentity.publicIp}` : 'Proxy protegido';
  }
  if (profile?.managedConnection) return 'Proxy asignado';
  return 'Conexión directa';
}

function descriptionFor(profile) {
  const host = domain(profile.url);
  if (profile.sessionMode === 'managed-first-party') {
    return profile.sessionReady
      ? `${host} · sesión v${profile.sessionVersion || 1}`
      : 'En mantenimiento';
  }
  return `${host} · acceso manual`;
}

async function launchProfile(profile, card) {
  if (launchingProfiles.has(profile.id)) return;
  const unavailable = profile.sessionMode === 'managed-first-party' && !profile.sessionReady;
  if (unavailable) return;

  launchingProfiles.add(profile.id);
  card.classList.add('launching');
  setError(catalogError, '');
  const state = card.querySelector('.card-state');
  if (state) state.textContent = 'Abriendo…';

  try {
    const result = await window.userflex.launchProfile(profile.id);
    if (!result?.ok) setError(catalogError, result?.error?.message || 'No se pudo abrir el perfil.');
  } finally {
    launchingProfiles.delete(profile.id);
    card.classList.remove('launching');
    if (state) state.textContent = 'Abrir';
  }
}

function makeProfileCard(profile) {
  const unavailable = profile.sessionMode === 'managed-first-party' && !profile.sessionReady;
  const card = document.createElement('article');
  card.className = `profile-card${unavailable ? ' unavailable' : ''}`;
  card.dataset.profileId = profile.id;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
  card.tabIndex = unavailable ? -1 : 0;
  card.title = unavailable ? 'Este perfil todavía no está disponible.' : `Abrir ${profileLabel(profile)}`;

  const image = document.createElement('div');
  image.className = 'profile-image';
  if (profile.imageUrl) {
    const img = document.createElement('img');
    img.src = profile.imageUrl;
    img.alt = '';
    image.appendChild(img);
  } else {
    const fallback = document.createElement('span');
    fallback.textContent = profileLabel(profile).slice(0, 1).toUpperCase();
    image.appendChild(fallback);
  }

  const body = document.createElement('div');
  body.className = 'profile-body';
  const title = document.createElement('h3');
  title.textContent = profileLabel(profile);
  const description = document.createElement('p');
  description.className = 'profile-description';
  description.textContent = descriptionFor(profile);
  body.append(title, description);

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const availability = document.createElement('span');
  availability.className = `availability${unavailable ? ' maintenance' : ''}`;
  availability.textContent = unavailable ? 'No disponible' : networkLabel(profile);
  const state = document.createElement('span');
  state.className = 'card-state';
  state.textContent = unavailable ? 'Mantenimiento' : 'Abrir';
  footer.append(availability, state);

  card.append(image, body, footer);
  if (!unavailable) {
    card.addEventListener('click', () => void launchProfile(profile, card));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void launchProfile(profile, card);
    });
  }
  return card;
}

function renderProfiles() {
  profilesGrid.replaceChildren();
  const profiles = Array.isArray(catalog?.profiles) ? catalog.profiles : [];
  const normalizedQuery = normalize(query.trim());
  const filtered = profiles.filter((profile) => {
    const matchesQuery = !normalizedQuery || profileSearchText(profile).includes(normalizedQuery);
    const matchesCategory = category === 'all' || profileCategories(profile).has(category);
    return matchesQuery && matchesCategory;
  });

  emptyState.classList.toggle('hidden', filtered.length !== 0);
  if (profiles.length === 0) {
    emptyState.querySelector('h3').textContent = 'No tienes perfiles asignados';
    emptyState.querySelector('p').textContent = 'Cuando el administrador te asigne un perfil aparecerá aquí automáticamente.';
  } else if (filtered.length === 0 && query.trim()) {
    emptyState.querySelector('h3').textContent = 'No se encontraron perfiles';
    emptyState.querySelector('p').textContent = `No hay coincidencias para “${query.trim()}”.`;
  } else if (filtered.length === 0) {
    emptyState.querySelector('h3').textContent = 'No hay perfiles en esta categoría';
    emptyState.querySelector('p').textContent = 'Prueba con otra categoría o selecciona Todos.';
  }

  for (const profile of filtered) profilesGrid.appendChild(makeProfileCard(profile));
}

function renderClient() {
  renderAccount();
  renderProfiles();
  show(clientView);
}

async function refreshCatalog() {
  refreshButton.disabled = true;
  refreshButton.classList.add('spinning');
  setError(catalogError, '');
  const result = await window.userflex.catalog();
  refreshButton.disabled = false;
  refreshButton.classList.remove('spinning');
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
  category = 'all';
  searchInput.value = '';
  for (const button of categoryFilters.querySelectorAll('.category-pill')) {
    button.classList.toggle('active', button.dataset.category === 'all');
  }
  renderClient();
});

searchInput.addEventListener('input', () => {
  query = searchInput.value;
  renderProfiles();
});

categoryFilters.addEventListener('click', (event) => {
  const button = event.target.closest('.category-pill');
  if (!button) return;
  category = button.dataset.category || 'all';
  for (const item of categoryFilters.querySelectorAll('.category-pill')) item.classList.toggle('active', item === button);
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
  category = 'all';
  loginForm.reset();
  setError(loginError, '');
  show(loginView);
});

window.userflex.onHeartbeat((payload) => {
  serverState.textContent = payload?.active === false ? 'Sin autorización' : 'Conectado';
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
