(function () {
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
  if (!mainCanvas || !mainContainer || !pipContainer) {
    return {
      subscribe() {},
      setRenderTarget() {},
      renderFrame() {},
    };
  }

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
  if (!frontStream || !backStream || !mainCanvas || !pipCanvas || !mainContainer || !pipContainer) {
    return;
  }

  const pipCameraKey = mainCameraKey === 'front' ? 'back' : 'front';

  if (mainCameraKey === 'front') {
    frontStream.setRenderTarget(mainCanvas, mainContainer);
    backStream.setRenderTarget(pipCanvas, pipContainer);
  } else {
    backStream.setRenderTarget(mainCanvas, mainContainer);
    frontStream.setRenderTarget(pipCanvas, pipContainer);
  }

  if (swapBtn) {
    swapBtn.setAttribute('aria-label', `Show ${CAMERA_TOPICS[pipCameraKey].label.toLowerCase()} as main`);
  }

  frontStream.renderFrame();
  backStream.renderFrame();
}

function swapMainCamera() {
  mainCameraKey = mainCameraKey === 'front' ? 'back' : 'front';
  applyCameraLayout();
}

function startCameras(ros) {
  if (!mainCanvas || !pipCanvas || !mainContainer || !pipContainer) {
    setStatus('Camera panel not ready', 'is-error');
    return;
  }

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

if (swapBtn) {
  swapBtn.addEventListener('click', swapMainCamera);
}

window.unitreeCamera = { start: startCameras };
})();
