(function () {
  const toastEl = document.getElementById('app-toast');
  const toastIconEl = document.getElementById('app-toast-icon');
  const toastTextEl = document.getElementById('app-toast-text');
  const toastProgressEl = document.getElementById('app-toast-progress');

  if (!toastEl || !toastTextEl) return;

  let toastTimer = null;
  let toastHideTimer = null;

  const TOAST_DURATION_MS = 3200;
  const TOAST_ICONS = {
    'is-success': '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 8.25 6.75 11 12 5"/></svg>',
    'is-error': '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5 5l6 6M11 5l-6 6"/></svg>',
  };

  function hideToast() {
    if (toastEl.classList.contains('hidden')) return;

    toastEl.classList.remove('is-visible');
    toastEl.classList.add('is-hiding');

    window.clearTimeout(toastHideTimer);
    toastHideTimer = window.setTimeout(() => {
      toastEl.classList.add('hidden');
      toastEl.classList.remove('is-hiding', 'is-success', 'is-error');
    }, 260);
  }

  function showToast(message, type = 'is-success') {
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);

    toastEl.classList.remove('hidden', 'is-hiding', 'is-visible', 'is-success', 'is-error');
    toastEl.classList.add(type);
    toastTextEl.textContent = message;

    if (toastIconEl) {
      toastIconEl.innerHTML = TOAST_ICONS[type] ?? TOAST_ICONS['is-success'];
    }

    if (toastProgressEl) {
      toastProgressEl.style.animation = 'none';
      void toastProgressEl.offsetWidth;
      toastProgressEl.style.animation = `app-toast-progress ${TOAST_DURATION_MS}ms linear forwards`;
    }

    window.requestAnimationFrame(() => {
      toastEl.classList.add('is-visible');
    });

    toastTimer = window.setTimeout(hideToast, TOAST_DURATION_MS);
  }

  window.unitreeAppToast = { show: showToast, hide: hideToast };
})();
