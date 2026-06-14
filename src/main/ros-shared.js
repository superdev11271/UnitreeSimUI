const SETTINGS_KEY = 'unitree-b2-ros-settings';
const CONNECT_TIMEOUT_MS = 10000;

let rosConnection = null;
let connectPromise = null;

function loadSettingsFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved?.ip && saved?.port) {
      return {
        ip: String(saved.ip).trim(),
        port: Number(saved.port) || 9090,
        url: `ws://${saved.ip}:${Number(saved.port) || 9090}`,
      };
    }
  } catch {
    // ignore invalid storage
  }
  return null;
}

async function resolveConnectionSettings() {
  const fromMain = await window.unitreeSim.getConnectionSettings();
  if (fromMain?.url) {
    return fromMain;
  }
  return loadSettingsFromStorage();
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function resetConnectionState() {
  if (rosConnection) {
    rosConnection.close();
  }
  rosConnection = null;
  connectPromise = null;
}

function connectRos(url) {
  return new Promise((resolve, reject) => {
    if (rosConnection?.isConnected) {
      resolve(rosConnection);
      return;
    }

    if (rosConnection) {
      rosConnection.close();
      rosConnection = null;
    }

    const ros = new ROSLIB.Ros({ url });
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(connectTimer);
      fn(value);
    };

    const onConnected = () => {
      rosConnection = ros;
      finish(resolve, ros);
    };

    const connectTimer = window.setTimeout(() => {
      ros.close();
      finish(reject, new Error('ROS connection timed out'));
    }, CONNECT_TIMEOUT_MS);

    ros.on('connection', onConnected);

    ros.on('error', () => {
      if (!settled) {
        finish(reject, new Error('Could not connect to rosbridge'));
      }
    });

    ros.on('close', () => {
      if (rosConnection === ros) {
        rosConnection = null;
        connectPromise = null;
      }
    });

    window.setTimeout(() => {
      if (!settled && ros.isConnected) {
        onConnected();
      }
    }, 0);
  });
}

async function createConnection() {
  const settings = await withTimeout(
    resolveConnectionSettings(),
    CONNECT_TIMEOUT_MS,
    'ROS settings timed out',
  );

  if (!settings?.url) {
    throw new Error('ROS settings not found');
  }

  return connectRos(settings.url);
}

window.unitreeRos = {
  reset() {
    resetConnectionState();
  },

  async getConnection() {
    if (rosConnection?.isConnected) {
      return rosConnection;
    }

    if (!connectPromise) {
      connectPromise = createConnection().catch((error) => {
        connectPromise = null;
        throw error;
      });
    }

    return connectPromise;
  },
};

async function connectWithRetry(attempts = 3) {
  let lastError = new Error('ROS connection failed');

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withTimeout(
        window.unitreeRos.getConnection(),
        CONNECT_TIMEOUT_MS,
        'ROS connection timed out',
      );
    } catch (error) {
      lastError = error;
      window.unitreeRos.reset();
      if (attempt < attempts - 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 400 * (attempt + 1));
        });
      }
    }
  }

  throw lastError;
}

function setWorldStatus(text, state) {
  const worldStatus = document.getElementById('world-status');
  if (!worldStatus) return;

  if (window.unitreeSensorStatus?.setPanelStatus) {
    window.unitreeSensorStatus.setPanelStatus(worldStatus, text, { state, mode: state ? 'error' : 'waiting' });
    return;
  }

  worldStatus.textContent = text;
  worldStatus.classList.remove('is-live', 'is-error');
  if (state) worldStatus.classList.add(state);
}

async function initMainApp() {
  setWorldStatus('Connecting…');

  try {
    const ros = await connectWithRetry();

    window.unitreeRobotControl?.start?.(ros);
    window.unitreeWorld?.start?.(ros);
    window.unitreeWorld?.setSubscribed?.(true);
  } catch (error) {
    setWorldStatus(error.message || 'ROS connection failed', 'is-error');
  }
}

initMainApp();
