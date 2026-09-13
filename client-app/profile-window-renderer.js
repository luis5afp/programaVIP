const tabsElement = document.getElementById('page-tabs');
const newPageButton = document.getElementById('new-page-button');
const profileIcon = document.getElementById('profile-icon');
const profileFallback = document.getElementById('profile-fallback');
const profileLabel = document.getElementById('profile-label');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const reloadButton = document.getElementById('reload-button');
const homeButton = document.getElementById('home-button');
const address = document.getElementById('address');
const networkState = document.getElementById('network-state');

let state = { profileId: null, profileLabel: 'Perfil', activePageId: null, pages: [], networkLabel: 'Aislado' };
let draggedPageId = null;

function activePage() {
  return state.pages.find((page) => page.id === state.activePageId) || null;
}

async function run(action, payload = {}) {
  return window.userflexProfileWindow.action(action, payload);
}

function makePageTab(page, index) {
  const item = document.createElement('div');
  item.className = `page-tab${page.id === state.activePageId ? ' active' : ''}`;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', page.id === state.activePageId ? 'true' : 'false');
  item.tabIndex = 0;
  item.draggable = true;
  item.dataset.pageId = page.id;
  item.title = page.title || page.url || 'Pestaña';

  const title = document.createElement('span');
  title.className = 'page-title';
  title.textContent = page.title || 'Nueva pestaña';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'page-close';
  close.title = 'Cerrar pestaña';
  close.setAttribute('aria-label', 'Cerrar pestaña');
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    void run('close-page', { pageId: page.id });
  });

  item.append(title, close);
  item.addEventListener('click', () => void run('select-page', { pageId: page.id }));
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void run('select-page', { pageId: page.id });
    }
  });
  item.addEventListener('dragstart', (event) => {
    draggedPageId = page.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', page.id);
  });
  item.addEventListener('dragover', (event) => {
    if (!draggedPageId || draggedPageId === page.id) return;
    event.preventDefault();
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', (event) => {
    event.preventDefault();
    item.classList.remove('drag-over');
    if (!draggedPageId || draggedPageId === page.id) return;
    void run('reorder-page', { pageId: draggedPageId, targetIndex: index });
    draggedPageId = null;
  });
  item.addEventListener('dragend', () => {
    draggedPageId = null;
    document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
  });
  return item;
}

function render() {
  tabsElement.replaceChildren();
  state.pages.forEach((page, index) => tabsElement.appendChild(makePageTab(page, index)));

  profileLabel.textContent = state.profileLabel || 'Perfil';
  profileFallback.textContent = String(state.profileLabel || 'P').slice(0, 1).toUpperCase();
  if (state.profileImageUrl) {
    profileIcon.src = state.profileImageUrl;
    profileIcon.classList.remove('hidden');
    profileFallback.classList.add('hidden');
  } else {
    profileIcon.classList.add('hidden');
    profileFallback.classList.remove('hidden');
  }

  const current = activePage();
  backButton.disabled = !current?.canGoBack;
  forwardButton.disabled = !current?.canGoForward;
  reloadButton.disabled = !current;
  homeButton.disabled = !current;
  address.textContent = current?.url || '—';
  networkState.textContent = state.networkLabel || 'Aislado';
  document.title = `userFLOW · ${state.profileLabel || 'Perfil'}`;
}

newPageButton.addEventListener('click', () => void run('new-page'));
backButton.addEventListener('click', () => void run('back', { pageId: state.activePageId }));
forwardButton.addEventListener('click', () => void run('forward', { pageId: state.activePageId }));
reloadButton.addEventListener('click', () => void run('reload', { pageId: state.activePageId }));
homeButton.addEventListener('click', () => void run('home', { pageId: state.activePageId }));

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    void run('new-page');
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'w' && state.activePageId) {
    event.preventDefault();
    void run('close-page', { pageId: state.activePageId });
    return;
  }
  if (event.ctrlKey && event.key === 'Tab' && state.pages.length > 1) {
    event.preventDefault();
    const currentIndex = Math.max(0, state.pages.findIndex((page) => page.id === state.activePageId));
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + state.pages.length) % state.pages.length;
    void run('select-page', { pageId: state.pages[nextIndex].id });
  }
});

window.userflexProfileWindow.onState((next) => {
  state = next || state;
  render();
});

(async () => {
  state = (await window.userflexProfileWindow.getState()) || state;
  render();
})();
