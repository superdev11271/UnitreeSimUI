(function () {
  function ensureStatusStructure(statusEl) {
    if (!statusEl) return;

    let dotEl = statusEl.querySelector('.sensor-status-dot');
    let labelEl = statusEl.querySelector('.sensor-status-text');

    if (!dotEl || !labelEl) {
      const text = statusEl.textContent;
      statusEl.textContent = '';

      dotEl = document.createElement('span');
      dotEl.className = 'sensor-status-dot is-waiting';
      dotEl.setAttribute('aria-hidden', 'true');

      labelEl = document.createElement('span');
      labelEl.className = 'sensor-status-text';
      labelEl.textContent = text;

      statusEl.appendChild(dotEl);
      statusEl.appendChild(labelEl);
    }

    if (!statusEl.querySelector('.world-status-motion-mode')) {
      const motionMode = document.createElement('span');
      motionMode.className = 'world-status-motion-mode hidden';
      motionMode.setAttribute('aria-hidden', 'true');
      statusEl.insertBefore(motionMode, labelEl);
    }

    if (!statusEl.querySelector('.world-status-speed')) {
      const speed = document.createElement('span');
      speed.className = 'world-status-speed hidden';
      speed.setAttribute('aria-hidden', 'true');
      statusEl.appendChild(speed);
    }
  }

  function setMotionModeDisplay(statusEl, motionMode) {
    ensureStatusStructure(statusEl);

    let modeEl = statusEl.querySelector('.world-status-motion-mode');
    if (!modeEl) {
      const dotEl = statusEl.querySelector('.sensor-status-dot');
      const labelEl = statusEl.querySelector('.sensor-status-text');
      modeEl = document.createElement('span');
      modeEl.className = 'world-status-motion-mode hidden';
      modeEl.setAttribute('aria-hidden', 'true');
      if (dotEl && labelEl) {
        statusEl.insertBefore(modeEl, labelEl);
      } else {
        statusEl.appendChild(modeEl);
      }
    }

    if (motionMode) {
      modeEl.textContent = motionMode;
      modeEl.classList.remove('hidden');
      modeEl.removeAttribute('aria-hidden');
      return;
    }

    modeEl.textContent = '';
    modeEl.classList.add('hidden');
    modeEl.setAttribute('aria-hidden', 'true');
  }

  function setSpeedDisplay(statusEl, speed) {
    ensureStatusStructure(statusEl);

    let speedEl = statusEl.querySelector('.world-status-speed');
    if (!speedEl) {
      speedEl = document.createElement('span');
      speedEl.className = 'world-status-speed hidden';
      speedEl.setAttribute('aria-hidden', 'true');
      statusEl.appendChild(speedEl);
    }

    if (speed !== null && speed !== undefined && Number.isFinite(speed)) {
      speedEl.textContent = `${speed.toFixed(2)} m/s`;
      speedEl.classList.remove('hidden');
      speedEl.removeAttribute('aria-hidden');
      return;
    }

    speedEl.textContent = '';
    speedEl.classList.add('hidden');
    speedEl.setAttribute('aria-hidden', 'true');
  }

  function setPanelStatus(statusEl, text, options = {}) {
    if (!statusEl) return;

    ensureStatusStructure(statusEl);

    const labelEl = statusEl.querySelector('.sensor-status-text');
    const dotEl = statusEl.querySelector('.sensor-status-dot');
    if (!labelEl || !dotEl) return;

    const { state = null, rate = null, mode = 'auto', speed = undefined } = options;

    labelEl.textContent = text;
    statusEl.classList.remove('is-live', 'is-error');
    if (state) statusEl.classList.add(state);

    if (speed !== undefined) {
      setSpeedDisplay(statusEl, speed);
    }

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
    setMotionModeDisplay,
  };
})();
