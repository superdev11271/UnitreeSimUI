const SETTINGS_KEY = 'unitree-b2-ros-settings';
const DEFAULT_SETTINGS = { ip: '127.0.0.1', port: 9090 };

const toast = document.getElementById('toast');
const btnStart = document.getElementById('btn-start');
const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');

let rosConnection = null;
let activeSettings = loadSettings();

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved?.ip && saved?.port) {
      return {
        ip: String(saved.ip).trim(),
        port: Number(saved.port) || DEFAULT_SETTINGS.port,
      };
    }
  } catch {
    // ignore invalid storage
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  activeSettings = settings;
}

function getRosUrl(settings = activeSettings) {
  return `ws://${settings.ip}:${settings.port}`;
}

function populateSettingsForm() {
  document.getElementById('ros-ip').value = activeSettings.ip;
  document.getElementById('ros-port').value = activeSettings.port;
}

function openSettingsDialog() {
  populateSettingsForm();
  settingsDialog.classList.remove('hidden');
  settingsDialog.setAttribute('aria-hidden', 'false');
  document.getElementById('ros-ip').focus();
}

function closeSettingsDialog() {
  settingsDialog.classList.add('hidden');
  settingsDialog.setAttribute('aria-hidden', 'true');
}

function disconnectRos() {
  if (rosConnection) {
    rosConnection.close();
    rosConnection = null;
  }
}

function connectRos(settings) {
  return new Promise((resolve, reject) => {
    disconnectRos();

    const ros = new ROSLIB.Ros({ url: getRosUrl(settings) });
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(connectTimer);
      fn(value);
    };

    const connectTimer = window.setTimeout(() => {
      ros.close();
      finish(reject, new Error('Connection timed out'));
    }, 8000);

    ros.on('connection', () => {
      rosConnection = ros;
      finish(resolve, ros);
    });

    ros.on('error', () => {
      finish(reject, new Error('Could not connect to rosbridge'));
    });

    ros.on('close', () => {
      if (rosConnection === ros) {
        rosConnection = null;
      }
    });
  });
}

async function handleStart() {
  btnStart.disabled = true;

  try {
    await connectRos(activeSettings);
    disconnectRos();

    const result = await window.unitreeSim.launchSimulator({
      ip: activeSettings.ip,
      port: activeSettings.port,
      url: getRosUrl(activeSettings),
    });

    showToast(result.message || 'Connected to ROS 2');
  } catch (error) {
    showToast(error.message || 'Failed to connect via roslib');
  } finally {
    btnStart.disabled = false;
  }
}

function handleSettingsSave(event) {
  event.preventDefault();

  const ip = document.getElementById('ros-ip').value.trim();
  const port = Number(document.getElementById('ros-port').value);

  if (!ip || !port || port < 1 || port > 65535) {
    showToast('Enter a valid IP address and port');
    return;
  }

  saveSettings({ ip, port });
  disconnectRos();
  closeSettingsDialog();
  showToast('Settings saved');
}

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

function setupWindowControls() {
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.unitreeSim.minimizeWindow();
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.unitreeSim.closeWindow();
  });
}

function setupPlatformLabel() {
  const label = document.getElementById('platform-label');
  const names = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };
  label.textContent = names[window.unitreeSim.platform] || window.unitreeSim.platform;
}

document.getElementById('btn-start').addEventListener('click', handleStart);
document.getElementById('btn-settings').addEventListener('click', openSettingsDialog);
document.getElementById('btn-close-settings').addEventListener('click', closeSettingsDialog);
document.getElementById('btn-cancel-settings').addEventListener('click', closeSettingsDialog);
settingsForm.addEventListener('submit', handleSettingsSave);

settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) {
    closeSettingsDialog();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsDialog.classList.contains('hidden')) {
    closeSettingsDialog();
  }
});

startTitlebarClock();
setupWindowControls();
setupPlatformLabel();
