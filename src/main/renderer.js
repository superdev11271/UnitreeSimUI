const workspace = document.getElementById('workspace');
const panels = [...document.querySelectorAll('.sub-panel')];

let maximizedPanel = null;

function setPanelMaximized(panel, maximized) {
  const btn = panel.querySelector('.panel-maximize');
  const iconMax = btn.querySelector('.icon-maximize');
  const iconRestore = btn.querySelector('.icon-restore');

  if (maximized) {
    maximizedPanel = panel;
    workspace.classList.add('is-panel-maximized');
    panel.classList.add('is-maximized');
    iconMax.classList.add('hidden');
    iconRestore.classList.remove('hidden');
    btn.setAttribute('aria-label', 'Restore panel');
  } else {
    maximizedPanel = null;
    workspace.classList.remove('is-panel-maximized');
    panel.classList.remove('is-maximized');
    iconMax.classList.remove('hidden');
    iconRestore.classList.add('hidden');
    btn.setAttribute('aria-label', 'Maximize panel');
  }
}

function togglePanelMaximize(panel) {
  if (maximizedPanel === panel) {
    setPanelMaximized(panel, false);
    return;
  }

  if (maximizedPanel) {
    setPanelMaximized(maximizedPanel, false);
  }

  setPanelMaximized(panel, true);
}

panels.forEach((panel) => {
  panel.querySelector('.panel-maximize').addEventListener('click', () => {
    togglePanelMaximize(panel);
  });
});

document.getElementById('btn-minimize').addEventListener('click', () => {
  window.unitreeSim.minimizeWindow();
});

document.getElementById('btn-maximize').addEventListener('click', async () => {
  const isMaximized = await window.unitreeSim.maximizeWindow();
  document.getElementById('btn-maximize').setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
});

document.getElementById('btn-close').addEventListener('click', () => {
  window.unitreeSim.closeWindow();
});
