const tabsElement = document.getElementById('tabs');
const catalogButton = document.getElementById('catalog-button');
const newTabButton = document.getElementById('new-tab-button');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const reloadButton = document.getElementById('reload-button');
const homeButton = document.getElementById('home-button');
const profileName = document.getElementById('profile-name');
const address = document.getElementById('address');
const networkState = document.getElementById('network-state');

let state = { activeProfileId: null, tabs: [] };

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeProfileId) || null;
}

async function run(action, profileId = state.activeProfileId) {
  await window.userflexBrowser.action(action, profileId || null);
}

function tabIcon(tab) {
  if (tab.imageUrl) {
    const image = document.createElement('img');
    image.className = 'tab-icon';
    image.alt = '';
    image.src = tab.imageUrl;
    return image;
  }
  const fallback = document.createElement('span');
  fallback.className = 'tab-icon-fallback';
  fallback.textContent = String(tab.label || 'P').slice(0, 1).toUpperCase();
  return fallback;
}

function renderTabs() {
  tabsElement.replaceChildren();
  for (const tab of state.tabs) {
    const item = document.createElement('div');
    item.className = `tab${tab.id === state.activeProfileId ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', tab.id === state.activeProfileId ? 'true' : 'false');
    item.tabIndex = 0;
    item.title = tab.label || 'Perfil';

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.label || 'Perfil';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.title = `Cerrar ${tab.label || 'perfil'}`;
    close.setAttribute('aria-label', `Cerrar ${tab.label || 'perfil'}`);
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void run('close', tab.id);
    });

    item.append(tabIcon(tab), title, close);
    item.addEventListener('click', () => void run('select', tab.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void run('select', tab.id);
      }
    });
    tabsElement.appendChild(item);
  }

  const current = activeTab();
  const hasTab = Boolean(current);
  backButton.disabled = !current?.canGoBack;
  forwardButton.disabled = !current?.canGoForward;
  reloadButton.disabled = !hasTab;
  homeButton.disabled = !hasTab;
  profileName.textContent = current?.label || 'Perfil';
  address.textContent = current?.url || '—';
  networkState.textContent = current?.networkLabel || 'Aislado';
  document.title = current ? `userFLEX · ${current.label}` : 'userFLEX Browser';
}

catalogButton.addEventListener('click', () => void run('catalog', null));
newTabButton.addEventListener('click', () => void run('catalog', null));
backButton.addEventListener('click', () => void run('back'));
forwardButton.addEventListener('click', () => void run('forward'));
reloadButton.addEventListener('click', () => void run('reload'));
homeButton.addEventListener('click', () => void run('home'));

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    void run('close');
    return;
  }
  if (event.ctrlKey && event.key === 'Tab' && state.tabs.length > 1) {
    event.preventDefault();
    const currentIndex = Math.max(0, state.tabs.findIndex((tab) => tab.id === state.activeProfileId));
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + state.tabs.length) % state.tabs.length;
    void run('select', state.tabs[nextIndex].id);
  }
});

window.userflexBrowser.onState((next) => {
  state = next || { activeProfileId: null, tabs: [] };
  renderTabs();
});

(async () => {
  state = (await window.userflexBrowser.getState()) || { activeProfileId: null, tabs: [] };
  renderTabs();
})();
