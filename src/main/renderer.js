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
  if (!status) return;
  const textEl = status.querySelector('.sensor-status-text');
  const currentText = textEl?.textContent ?? status.textContent;
  if (!currentText.startsWith('Loading world model')) return;
  if (window.unitreeSensorStatus?.setPanelStatus) {
    window.unitreeSensorStatus.setPanelStatus(
      status,
      event.reason?.message || 'World viewer failed to start',
      { state: 'is-error', mode: 'error' },
    );
    return;
  }
  status.textContent = event.reason?.message || 'World viewer failed to start';
  status.classList.add('is-error');
});

document.getElementById('btn-reset-simulation')?.addEventListener('click', () => {
  window.unitreeResetSimulation?.openDialog();
});

const controlsToggleBtn = document.getElementById('world-controls-toggle-btn');
const robotControls = document.getElementById('robot-controls');

function setControlsPanelVisible(visible) {
  robotControls?.classList.toggle('is-hidden', !visible);
  controlsToggleBtn?.classList.toggle('is-controls-visible', visible);
  controlsToggleBtn?.setAttribute('aria-pressed', visible ? 'true' : 'false');
  controlsToggleBtn?.setAttribute('aria-label', visible ? 'Hide controls' : 'Show controls');
  window.unitreeRobotControl?.setControlsEnabled?.(visible);
}

controlsToggleBtn?.addEventListener('click', () => {
  const visible = !robotControls?.classList.contains('is-hidden');
  setControlsPanelVisible(!visible);
});

setControlsPanelVisible(false);

const appRoot = document.querySelector('.app');
const maximizeBtn = document.getElementById('btn-maximize');

function setFullScreenUi(isFullScreen) {
  appRoot?.classList.toggle('is-fullscreen', isFullScreen);
  maximizeBtn?.setAttribute('aria-label', isFullScreen ? 'Restore' : 'Maximize');
}

window.unitreeSim.onFullScreenChange?.(setFullScreenUi);

document.getElementById('btn-minimize').addEventListener('click', () => {
  window.unitreeSim.minimizeWindow();
});

maximizeBtn?.addEventListener('click', async () => {
  const isFullScreen = await window.unitreeSim.maximizeWindow();
  setFullScreenUi(isFullScreen);
});

document.getElementById('btn-close').addEventListener('click', () => {
  window.unitreeSim.closeWindow();
});
