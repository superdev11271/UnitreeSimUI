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
