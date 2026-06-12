(function () {
  function ensureStatusStructure(statusEl) {
    if (!statusEl || statusEl.querySelector('.sensor-status-dot')) return;

    const text = statusEl.textContent;
    statusEl.textContent = '';

    const dot = document.createElement('span');
    dot.className = 'sensor-status-dot is-waiting';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'sensor-status-text';
    label.textContent = text;

    statusEl.appendChild(dot);
    statusEl.appendChild(label);
  }

  function setPanelStatus(statusEl, text, options = {}) {
    if (!statusEl) return;

    ensureStatusStructure(statusEl);

    const labelEl = statusEl.querySelector('.sensor-status-text');
    const dotEl = statusEl.querySelector('.sensor-status-dot');
    if (!labelEl || !dotEl) return;

    const { state = null, rate = null, mode = 'auto' } = options;

    labelEl.textContent = text;
    statusEl.classList.remove('is-live', 'is-error');
    if (state) statusEl.classList.add(state);

    dotEl.classList.remove('is-available', 'is-unavailable', 'is-disabled', 'is-waiting', 'is-error');

    if (state === 'is-error' || mode === 'error') {
      dotEl.classList.add('is-error');
      return;
    }

    if (text === 'Disabled' || mode === 'disabled') {
      dotEl.classList.add('is-disabled');
      return;
    }

    if (rate !== null && rate > 0) {
      dotEl.classList.add('is-available');
      return;
    }

    if (rate !== null && rate === 0) {
      dotEl.classList.add('is-unavailable');
      return;
    }

    dotEl.classList.add('is-waiting');
  }

  window.unitreeSensorStatus = {
    setPanelStatus,
  };
})();
