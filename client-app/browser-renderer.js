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
let profilePointerDrag = null;
let queuedState = null;

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
    image.draggable = false;
    image.src = tab.imageUrl;
    return image;
  }
  const fallback = document.createElement('span');
  fallback.className = 'tab-icon-fallback';
  fallback.textContent = String(tab.label || 'P').slice(0, 1).toUpperCase();
  return fallback;
}

function profileTabNodes() {
  return Array.from(tabsElement.querySelectorAll('.tab[data-profile-id]'));
}

function clearDragVisuals() {
  document.querySelectorAll('.tab.drag-over, .tab.dragging').forEach((node) => {
    node.classList.remove('drag-over', 'dragging');
  });
}

function targetIndexFromClientX(clientX) {
  const nodes = profileTabNodes();
  if (!nodes.length) return 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const rect = nodes[index].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return index;
  }
  return nodes.length - 1;
}

function markTargetIndex(index, profileId) {
  const nodes = profileTabNodes();
  nodes.forEach((node, nodeIndex) => {
    node.classList.toggle('drag-over', nodeIndex === index && node.dataset.profileId !== profileId);
    node.classList.toggle('dragging', node.dataset.profileId === profileId);
  });
}

function beginProfilePointerDrag(item, tab, index, event) {
  if (event.button !== 0 || event.target.closest('.tab-close')) return;
  event.preventDefault();
  queuedState = null;
  profilePointerDrag = {
    profileId: tab.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    targetIndex: index,
    moved: false,
  };
  try { item.setPointerCapture(event.pointerId); } catch {}
  void run('profile-drag-begin', tab.id);
}

function moveProfilePointerDrag(event) {
  const drag = profilePointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && distance < 5) return;
  drag.moved = true;
  drag.targetIndex = targetIndexFromClientX(event.clientX);
  markTargetIndex(drag.targetIndex, drag.profileId);
}

async function endProfilePointerDrag(item, event, canceled = false) {
  const drag = profilePointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const pending = queuedState;
  profilePointerDrag = null;
  queuedState = null;
  clearDragVisuals();
  try {
    if (item.hasPointerCapture(event.pointerId)) item.releasePointerCapture(event.pointerId);
  } catch {}

  const result = await run('profile-drag-end', drag.profileId);
  if (canceled) {
    if (pending) {
      state = pending;
      renderTabs();
    }
    return;
  }
  if (!result?.detached) {
    if (drag.moved) await run('reorder', drag.profileId, { targetIndex: drag.targetIndex });
    else await run('select', drag.profileId);
  }
}

function makeProfileTab(tab, index) {
  const item = document.createElement('div');
  item.className = `tab${tab.id === state.activeProfileId ? ' active' : ''}${tab.loading ? ' loading' : ''}`;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', tab.id === state.activeProfileId ? 'true' : 'false');
  item.tabIndex = 0;
  item.title = `${tab.label || 'Perfil'} · arrastra para reordenar o sacar a otra ventana`;
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
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void run('select', tab.id);
    }
  });
  item.addEventListener('pointerdown', (event) => beginProfilePointerDrag(item, tab, index, event));
  item.addEventListener('pointermove', moveProfilePointerDrag);
  item.addEventListener('pointerup', (event) => void endProfilePointerDrag(item, event, false));
  item.addEventListener('pointercancel', (event) => void endProfilePointerDrag(item, event, true));
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
  const normalized = next || { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
  if (profilePointerDrag) {
    const stillAttached = normalized.tabs.some((tab) => tab.id === profilePointerDrag.profileId);
    if (stillAttached) {
      queuedState = normalized;
      return;
    }
    profilePointerDrag = null;
    queuedState = null;
    clearDragVisuals();
  }
  state = normalized;
  renderTabs();
});

(async () => {
  state = (await window.userflexBrowser.getState()) || { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
  renderTabs();
})();
