function startTitlebarClock() {
  const clockEl = document.getElementById('titlebar-clock');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    clockEl.dateTime = now.toISOString();
    clockEl.textContent = now.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  tick();
  window.setInterval(tick, 1000);
}

startTitlebarClock();

window.addEventListener('unhandledrejection', (event) => {
  const status = document.getElementById('world-status');
  if (!status || !status.textContent.startsWith('Loading world model')) return;
  status.textContent = event.reason?.message || 'World viewer failed to start';
  status.classList.add('is-error');
});

document.getElementById('btn-reset-simulation')?.addEventListener('click', () => {
  window.unitreeRobotControl?.publishResetSimulation();
});

const workspace = document.getElementById('workspace');
const panels = [...document.querySelectorAll('.sub-panel')];

let maximizedPanel = null;

const PANEL_HANDLERS = {
  1: (active) => window.unitreeCamera?.primary?.setSubscribed?.(active),
  2: (active) => window.unitreeLidar?.setSubscribed?.(active),
  3: (active) => window.unitreeCamera?.third?.setSubscribed?.(active),
  4: (active) => window.unitreeWorld?.setSubscribed?.(active),
};

function isPanelEnabled(panel) {
  return !panel.classList.contains('is-panel-disabled');
}

function shouldPanelSubscribe(panel) {
  if (!isPanelEnabled(panel)) return false;
  if (!maximizedPanel) return true;
  return maximizedPanel === panel;
}

function syncPanelSubscriptions() {
  panels.forEach((panel) => {
    const panelId = panel.dataset.panel;
    const handler = PANEL_HANDLERS[panelId];
    if (!handler) return;
    handler(shouldPanelSubscribe(panel));
  });
}

function updatePanelToggleUi(panel) {
  const toggleBtn = panel.querySelector('.panel-toggle');
  if (!toggleBtn) return;

  const enabled = isPanelEnabled(panel);
  toggleBtn.classList.toggle('is-off', !enabled);
  toggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  toggleBtn.setAttribute('aria-label', enabled ? 'Disable panel' : 'Enable panel');
}

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

  syncPanelSubscriptions();
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

function togglePanelEnabled(panel) {
  panel.classList.toggle('is-panel-disabled');
  updatePanelToggleUi(panel);
  syncPanelSubscriptions();
}

panels.forEach((panel) => {
  updatePanelToggleUi(panel);

  panel.querySelector('.panel-toggle')?.addEventListener('click', () => {
    togglePanelEnabled(panel);
  });

  panel.querySelector('.panel-maximize')?.addEventListener('click', () => {
    togglePanelMaximize(panel);
  });
});

window.unitreePanelManager = {
  init(ros) {
    window.unitreeCamera?.start?.(ros);
    window.unitreeLidar?.start?.(ros);
    window.unitreeWorld?.start?.(ros);
    window.unitreeRobotControl?.start?.(ros);
    syncPanelSubscriptions();
  },

  syncSubscriptions: syncPanelSubscriptions,
};

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
