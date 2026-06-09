const SETTINGS_KEY = 'unitree-b2-ros-settings';

const CAMERA_TOPICS = {
  front: {
    imageTopic: '/camera_front/camera_sensor/image_raw/compressed',
    infoTopic: '/camera_front/camera_sensor/camera_info',
    label: 'Front Camera',
  },
  back: {
    imageTopic: '/camera_back/camera_sensor/image_raw/compressed',
    infoTopic: '/camera_back/camera_sensor/camera_info',
    label: 'Back Camera',
  },
};

const mainCanvas = document.getElementById('main-camera-canvas');
const pipCanvas = document.getElementById('pip-camera-canvas');
const mainContainer = document.querySelector('.camera-panel');
const pipContainer = document.querySelector('.camera-pip');
const statusEl = document.getElementById('front-camera-status');
const swapBtn = document.getElementById('camera-swap-btn');

let rosConnection = null;
let mainCameraKey = 'front';
let frontStream = null;
let backStream = null;

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }
  if (typeof data === 'string') {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(0);
}

function drawCover(destCtx, destCanvas, source, destWidth, destHeight) {
  if (destWidth <= 0 || destHeight <= 0) {
    return;
  }

  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (!sourceWidth || !sourceHeight) {
    return;
  }

  destCanvas.width = destWidth;
  destCanvas.height = destHeight;

  const scale = Math.max(destWidth / sourceWidth, destHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (destWidth - drawWidth) / 2;
  const offsetY = (destHeight - drawHeight) / 2;

  destCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight, offsetX, offsetY, drawWidth, drawHeight);
}

function createCameraStream({ imageTopic, infoTopic, onLive }) {
  const sourceCanvas = document.createElement('canvas');
  const sourceCtx = sourceCanvas.getContext('2d');
  let canvas = mainCanvas;
  let container = mainContainer;
  let ctx = canvas.getContext('2d');
  let lastObjectUrl = null;
  let hasFrame = false;
  let lastLabel = '';

  function getContainerSize() {
    return {
      width: Math.max(1, Math.floor(container.clientWidth)),
      height: Math.max(1, Math.floor(container.clientHeight)),
    };
  }

  function renderFrame() {
    if (!hasFrame) {
      return;
    }

    const { width, height } = getContainerSize();
    drawCover(ctx, canvas, sourceCanvas, width, height);

    if (lastLabel && onLive) {
      onLive(lastLabel);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    renderFrame();
  });
  resizeObserver.observe(mainContainer);
  resizeObserver.observe(pipContainer);

  function setRenderTarget(nextCanvas, nextContainer) {
    canvas = nextCanvas;
    container = nextContainer;
    ctx = canvas.getContext('2d');
    renderFrame();
  }

  function drawCompressedImage(message) {
    const { format, data } = message;
    const bytes = toUint8Array(data);
    if (!bytes.length) {
      return;
    }

    const normalizedFormat = String(format || '').toLowerCase();
    let mime = 'image/jpeg';
    let labelFormat = 'jpeg';

    if (normalizedFormat.includes('png')) {
      mime = 'image/png';
      labelFormat = 'png';
    } else if (normalizedFormat.includes('jpeg') || normalizedFormat.includes('jpg')) {
      mime = 'image/jpeg';
      labelFormat = 'jpeg';
    } else if (normalizedFormat) {
      labelFormat = normalizedFormat;
    }

    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
    }

    lastObjectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.onload = () => {
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      sourceCtx.drawImage(img, 0, 0);
      hasFrame = true;
      lastLabel = `${img.width}×${img.height} · ${labelFormat}`;
      renderFrame();
    };
    img.onerror = () => {
      setStatus('Failed to decode compressed image', 'is-error');
    };
    img.src = lastObjectUrl;
  }

  function subscribe(ros) {
    const info = new ROSLIB.Topic({
      ros,
      name: infoTopic,
      messageType: 'sensor_msgs/msg/CameraInfo',
    });

    info.subscribe(() => {});

    const image = new ROSLIB.Topic({
      ros,
      name: imageTopic,
      messageType: 'sensor_msgs/msg/CompressedImage',
    });

    image.subscribe((message) => {
      drawCompressedImage(message);
    });
  }

  return { subscribe, setRenderTarget, renderFrame };
}

function setStatus(text, state) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-live', 'is-error');
  if (state) {
    statusEl.classList.add(state);
  }
}

function applyCameraLayout() {
  const pipCameraKey = mainCameraKey === 'front' ? 'back' : 'front';

  if (mainCameraKey === 'front') {
    frontStream.setRenderTarget(mainCanvas, mainContainer);
    backStream.setRenderTarget(pipCanvas, pipContainer);
  } else {
    backStream.setRenderTarget(mainCanvas, mainContainer);
    frontStream.setRenderTarget(pipCanvas, pipContainer);
  }

  swapBtn.setAttribute('aria-label', `Show ${CAMERA_TOPICS[pipCameraKey].label.toLowerCase()} as main`);

  frontStream.renderFrame();
  backStream.renderFrame();
}

function swapMainCamera() {
  mainCameraKey = mainCameraKey === 'front' ? 'back' : 'front';
  applyCameraLayout();
}

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

function connectRos(url) {
  return new Promise((resolve, reject) => {
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

    const connectTimer = window.setTimeout(() => {
      ros.close();
      finish(reject, new Error('ROS connection timed out'));
    }, 8000);

    ros.on('connection', () => {
      rosConnection = ros;
      finish(resolve, ros);
    });

    ros.on('error', () => {
      finish(reject, new Error('Could not connect to rosbridge'));
    });
  });
}

function startCameras(ros) {
  frontStream = createCameraStream({
    ...CAMERA_TOPICS.front,
    onLive: (label) => {
      if (mainCameraKey === 'front') {
        setStatus(label, 'is-live');
      }
    },
  });

  backStream = createCameraStream({
    ...CAMERA_TOPICS.back,
    onLive: (label) => {
      if (mainCameraKey === 'back') {
        setStatus(label, 'is-live');
      }
    },
  });

  frontStream.subscribe(ros);
  backStream.subscribe(ros);
  applyCameraLayout();
  setStatus(`Subscribed · ${CAMERA_TOPICS[mainCameraKey].imageTopic}`, null);
}

async function initCameras() {
  const settings = await resolveConnectionSettings();
  if (!settings?.url) {
    setStatus('ROS settings not found', 'is-error');
    return;
  }

  setStatus(`Connecting · ${settings.url}`, null);

  try {
    const ros = await connectRos(settings.url);
    startCameras(ros);
  } catch (error) {
    setStatus(error.message || 'Camera connection failed', 'is-error');
  }
}

swapBtn.addEventListener('click', swapMainCamera);
initCameras();
