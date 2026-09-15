const tabsElement = document.getElementById('page-tabs');
const newPageButton = document.getElementById('new-page-button');
const newPageWrap = document.getElementById('new-page-wrap');
const newPageMenu = document.getElementById('new-page-menu');
const newProfilePageOption = document.getElementById('new-profile-page-option');
const googlePageOption = document.getElementById('google-page-option');
const profileIcon = document.getElementById('profile-icon');
const profileFallback = document.getElementById('profile-fallback');
const profileLabel = document.getElementById('profile-label');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const reloadButton = document.getElementById('reload-button');
const homeButton = document.getElementById('home-button');
const address = document.getElementById('address');
const networkState = document.getElementById('network-state');

let state = { profileId: null, profileLabel: 'Perfil', activePageId: null, pages: [], networkLabel: 'Aislado', allowExternalBrowsing: false };
let pagePointerDrag = null;
let queuedState = null;
let newPageHoverTimer = null;

function activePage() {
  return state.pages.find((page) => page.id === state.activePageId) || null;
}

async function run(action, payload = {}) {
  return window.userflexProfileWindow.action(action, payload);
}

function pageTabNodes() {
  return Array.from(tabsElement.querySelectorAll('.page-tab[data-page-id]'));
}

function clearPageDragVisuals() {
  document.querySelectorAll('.page-tab.drag-over, .page-tab.dragging').forEach((node) => {
    node.classList.remove('drag-over', 'dragging');
  });
}

function targetIndexFromClientX(clientX) {
  const nodes = pageTabNodes();
  if (!nodes.length) return 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const rect = nodes[index].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return index;
  }
  return nodes.length - 1;
}

function markPageTarget(index, pageId) {
  pageTabNodes().forEach((node, nodeIndex) => {
    node.classList.toggle('drag-over', nodeIndex === index && node.dataset.pageId !== pageId);
    node.classList.toggle('dragging', node.dataset.pageId === pageId);
  });
}

function beginPagePointerDrag(item, page, index, event) {
  if (event.button !== 0 || event.target.closest('.page-close')) return;
  event.preventDefault();
  queuedState = null;
  pagePointerDrag = {
    pageId: page.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    targetIndex: index,
    moved: false,
  };
  try { item.setPointerCapture(event.pointerId); } catch {}
}

function movePagePointerDrag(event) {
  const drag = pagePointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && distance < 5) return;
  drag.moved = true;
  drag.targetIndex = targetIndexFromClientX(event.clientX);
  markPageTarget(drag.targetIndex, drag.pageId);
}

async function endPagePointerDrag(item, event, canceled = false) {
  const drag = pagePointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const pending = queuedState;
  pagePointerDrag = null;
  queuedState = null;
  clearPageDragVisuals();
  try {
    if (item.hasPointerCapture(event.pointerId)) item.releasePointerCapture(event.pointerId);
  } catch {}

  if (canceled) {
    if (pending) {
      state = pending;
      render();
    }
    return;
  }
  if (drag.moved) await run('reorder-page', { pageId: drag.pageId, targetIndex: drag.targetIndex });
  else await run('select-page', { pageId: drag.pageId });
}

function makePageTab(page, index) {
  const item = document.createElement('div');
  item.className = `page-tab${page.id === state.activePageId ? ' active' : ''}`;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', page.id === state.activePageId ? 'true' : 'false');
  item.tabIndex = 0;
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
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void run('select-page', { pageId: page.id });
    }
  });
  item.addEventListener('pointerdown', (event) => beginPagePointerDrag(item, page, index, event));
  item.addEventListener('pointermove', movePagePointerDrag);
  item.addEventListener('pointerup', (event) => void endPagePointerDrag(item, event, false));
  item.addEventListener('pointercancel', (event) => void endPagePointerDrag(item, event, true));
  return item;
}

function closeNewPageMenu() {
  if (newPageHoverTimer) clearTimeout(newPageHoverTimer);
  newPageHoverTimer = null;
  newPageMenu.classList.remove('open');
}

function scheduleNewPageMenu() {
  if (newPageHoverTimer) clearTimeout(newPageHoverTimer);
  newPageHoverTimer = setTimeout(() => {
    googlePageOption.classList.toggle('hidden', state.allowExternalBrowsing !== true);
    newPageMenu.classList.add('open');
  }, 420);
}

function render() {
  tabsElement.replaceChildren();
  state.pages.forEach((page, index) => tabsElement.appendChild(makePageTab(page, index)));

  profileLabel.textContent = state.profileLabel || 'Perfil';
  profileFallback.textContent = String(state.profileLabel || 'P').slice(0, 1).toUpperCase();
  if (state.profileImageUrl) {
    profileIcon.src = state.profileImageUrl;
    profileIcon.draggable = false;
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
  googlePageOption.classList.toggle('hidden', state.allowExternalBrowsing !== true);
  document.title = `userFLOW · ${state.profileLabel || 'Perfil'}`;
}

newPageButton.addEventListener('click', () => {
  closeNewPageMenu();
  void run('new-page');
});
newPageWrap.addEventListener('mouseenter', scheduleNewPageMenu);
newPageWrap.addEventListener('mouseleave', closeNewPageMenu);
newProfilePageOption.addEventListener('click', (event) => {
  event.stopPropagation();
  closeNewPageMenu();
  void run('new-page');
});
googlePageOption.addEventListener('click', (event) => {
  event.stopPropagation();
  closeNewPageMenu();
  if (state.allowExternalBrowsing === true) void run('open-google');
});
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
  const normalized = next || state;
  if (pagePointerDrag) {
    const stillExists = normalized.pages.some((page) => page.id === pagePointerDrag.pageId);
    if (stillExists) {
      queuedState = normalized;
      return;
    }
    pagePointerDrag = null;
    queuedState = null;
    clearPageDragVisuals();
  }
  state = normalized;
  render();
});

(async () => {
  state = (await window.userflexProfileWindow.getState()) || state;
  render();
})();
