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

let state = { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
let draggedProfileId = null;
let dragDropped = false;

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeProfileId) || null;
}

async function run(action, profileId = state.activeProfileId, extra = {}) {
  return window.userflexBrowser.action(action, profileId || null, extra);
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

function clearDragMarkers() {
  document.querySelectorAll('.tab.drag-over').forEach((node) => node.classList.remove('drag-over'));
}

function makeProfileTab(tab, index) {
  const item = document.createElement('div');
  item.className = `tab${tab.id === state.activeProfileId ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', tab.id === state.activeProfileId ? 'true' : 'false');
  item.tabIndex = 0;
  item.title = `${tab.label || 'Perfil'} · arrastra para reordenar o sacar a otra ventana`;
  item.draggable = true;
  item.dataset.profileId = tab.id;

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
  item.addEventListener('dragstart', (event) => {
    draggedProfileId = tab.id;
    dragDropped = false;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
  });
  item.addEventListener('dragover', (event) => {
    if (!draggedProfileId || draggedProfileId === tab.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDropped = true;
    item.classList.remove('drag-over');
    if (!draggedProfileId || draggedProfileId === tab.id) return;
    void run('reorder', draggedProfileId, { targetIndex: index });
  });
  item.addEventListener('dragend', (event) => {
    const id = draggedProfileId;
    clearDragMarkers();
    draggedProfileId = null;
    if (!id || dragDropped || (event.screenX === 0 && event.screenY === 0)) {
      dragDropped = false;
      return;
    }
    dragDropped = false;
    void run('detach-if-outside', id, { screenX: event.screenX, screenY: event.screenY });
  });
  return item;
}

function makePendingTab() {
  const item = document.createElement('div');
  item.className = 'tab pending active';
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', 'true');
  item.tabIndex = 0;
  item.title = 'Elige un perfil del catálogo';

  const icon = document.createElement('span');
  icon.className = 'tab-icon-fallback pending-icon';
  icon.textContent = '+';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = 'Nueva pestaña';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.title = 'Cerrar nueva pestaña';
  close.setAttribute('aria-label', 'Cerrar nueva pestaña');
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    void run('close-pending', null);
  });

  item.append(icon, title, close);
  return item;
}

function renderTabs() {
  tabsElement.replaceChildren();
  state.tabs.forEach((tab, index) => tabsElement.appendChild(makeProfileTab(tab, index)));
  if (state.pendingTab) tabsElement.appendChild(makePendingTab());

  const current = activeTab();
  const inCatalog = !current;
  document.body.classList.toggle('catalog-mode', inCatalog);
  catalogButton.classList.toggle('active', state.catalogMode === 'home');

  backButton.disabled = !current?.canGoBack;
  forwardButton.disabled = !current?.canGoForward;
  reloadButton.disabled = !current;
  homeButton.disabled = !current;
  profileName.textContent = current?.label || 'Catálogo';
  address.textContent = current?.url || 'Selecciona un perfil';
  networkState.textContent = current?.networkLabel || 'Catálogo';
  document.title = current ? `userFLOW · ${current.label}` : 'userFLOW · Catálogo';
}

catalogButton.addEventListener('click', () => void run('catalog-home', null));
newTabButton.addEventListener('click', () => void run('new-tab', null));
backButton.addEventListener('click', () => void run('back'));
forwardButton.addEventListener('click', () => void run('forward'));
reloadButton.addEventListener('click', () => void run('reload'));
homeButton.addEventListener('click', () => void run('home'));

tabsElement.addEventListener('dragover', (event) => {
  if (!draggedProfileId) return;
  event.preventDefault();
});
tabsElement.addEventListener('drop', (event) => {
  if (!draggedProfileId) return;
  event.preventDefault();
  dragDropped = true;
  const profileId = draggedProfileId;
  const rect = tabsElement.getBoundingClientRect();
  if (event.clientX >= rect.right - 24) void run('reorder', profileId, { targetIndex: Math.max(0, state.tabs.length - 1) });
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    void run('new-tab', null);
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'w') {
    if (state.pendingTab) {
      event.preventDefault();
      void run('close-pending', null);
      return;
    }
    if (state.activeProfileId) {
      event.preventDefault();
      void run('close');
    }
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'l' && state.activeProfileId) {
    event.preventDefault();
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
  state = next || { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
  renderTabs();
});

(async () => {
  state = (await window.userflexBrowser.getState()) || { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
  renderTabs();
})();
