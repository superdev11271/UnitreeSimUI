(function () {
const LIDAR_TOPIC = '/rslidar_points';
const DEFAULT_MESSAGE_TYPE = 'sensor_msgs/msg/PointCloud2';
const MAX_POINTS_PER_FRAME = 20000;
const LIDAR_MIN_RANGE_M = 0.2;
const LIDAR_MIN_INTENSITY = 1;
const LIDAR_MAX_RANGE_M = 200;
const LIDAR_MAX_RANGE_MARGIN_M = 0.5;

const canvas = document.getElementById('lidar-canvas');
const container = document.querySelector('.lidar-panel');
const statusEl = document.getElementById('lidar-status');

let lidarTopic = null;
let messageCount = 0;
let viewer = null;

function setStatus(text, state) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-live', 'is-error');
  if (state) {
    statusEl.classList.add(state);
  }
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data && typeof data === 'object') {
    if (Array.isArray(data.data)) return new Uint8Array(data.data);
    if (typeof data.data === 'string') return toUint8Array(data.data);
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

function toDataView(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return new DataView(bytes.buffer);
  }
  return new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function normalizeFields(fields) {
  if (!fields) return [];
  if (Array.isArray(fields)) return fields;
  if (typeof fields === 'object') return Object.values(fields);
  return [];
}

function findField(fields, name) {
  return fields.find((entry) => entry?.name === name) || null;
}

function readFieldValue(dataView, base, field, littleEndian) {
  if (!field) return Number.NaN;

  const offset = base + (field.offset ?? 0);
  const datatype = field.datatype ?? field.data_type ?? 7;

  if (offset < 0 || offset >= dataView.byteLength) return Number.NaN;

  switch (datatype) {
    case 1:
      return dataView.getInt8(offset);
    case 2:
      return dataView.getUint8(offset);
    case 3:
      if (offset + 2 > dataView.byteLength) return Number.NaN;
      return dataView.getInt16(offset, littleEndian);
    case 4:
      if (offset + 2 > dataView.byteLength) return Number.NaN;
      return dataView.getUint16(offset, littleEndian);
    case 5:
      if (offset + 4 > dataView.byteLength) return Number.NaN;
      return dataView.getInt32(offset, littleEndian);
    case 6:
      if (offset + 4 > dataView.byteLength) return Number.NaN;
      return dataView.getUint32(offset, littleEndian);
    case 7:
      if (offset + 4 > dataView.byteLength) return Number.NaN;
      return dataView.getFloat32(offset, littleEndian);
    case 8:
      if (offset + 8 > dataView.byteLength) return Number.NaN;
      return dataView.getFloat64(offset, littleEndian);
    default:
      return Number.NaN;
  }
}

function findIntensityField(fields) {
  return findField(fields, 'intensity') || findField(fields, 'i');
}

function isMaxRangePoint(range, intensity, hasIntensityField, frameMaxRange) {
  const nearConfiguredMax = range >= LIDAR_MAX_RANGE_M - LIDAR_MAX_RANGE_MARGIN_M;
  if (nearConfiguredMax) {
    return true;
  }

  const nearFrameMax = range >= frameMaxRange - LIDAR_MAX_RANGE_MARGIN_M;
  if (!nearFrameMax) {
    return false;
  }

  if (hasIntensityField && Number.isFinite(intensity) && intensity < LIDAR_MIN_INTENSITY) {
    return true;
  }

  return frameMaxRange >= LIDAR_MAX_RANGE_M - LIDAR_MAX_RANGE_MARGIN_M;
}

function shouldKeepLidarPoint(range, intensity, hasIntensityField, frameMaxRange) {
  if (!Number.isFinite(range) || range < LIDAR_MIN_RANGE_M) {
    return false;
  }

  if (hasIntensityField && Number.isFinite(intensity) && intensity < LIDAR_MIN_INTENSITY) {
    return false;
  }

  if (isMaxRangePoint(range, intensity, hasIntensityField, frameMaxRange)) {
    return false;
  }

  return true;
}

function rosToScene(x, y, z) {
  return { x, y: z, z: -y };
}

function heightColor(z) {
  const t = Math.min(1, Math.max(0, (z + 1) / 4));
  return {
    r: 0,
    g: (229 * (1 - t) + 153 * t) / 255,
    b: (192 * (1 - t) + 255 * t) / 255,
  };
}

function parsePointCloud2(message) {
  const bytes = toUint8Array(message.data);
  const fields = normalizeFields(message.fields);
  const pointStep = Number(message.point_step ?? message.pointStep ?? 0);
  const width = Number(message.width ?? 0);
  const height = Number(message.height ?? 0);
  const isBigEndian = Boolean(message.is_bigendian ?? message.isBigendian);
  const pointCount = width * height || (pointStep ? Math.floor(bytes.length / pointStep) : 0);

  if (!pointCount || !pointStep || !bytes.length) {
    return { points: [], reason: `empty cloud (${pointCount} pts, ${bytes.length} bytes)` };
  }

  if (!fields.length) {
    return { points: [], reason: 'missing fields metadata' };
  }

  const xField = findField(fields, 'x');
  const yField = findField(fields, 'y');
  const zField = findField(fields, 'z');
  const intensityField = findIntensityField(fields);
  const hasIntensityField = Boolean(intensityField);
  if (!xField || !yField) {
    const names = fields.map((field) => field.name).join(', ');
    return { points: [], reason: `missing x/y fields (${names || 'none'})` };
  }

  const littleEndian = !isBigEndian;
  const dataView = toDataView(bytes);
  const stride = Math.max(1, Math.ceil(pointCount / MAX_POINTS_PER_FRAME));
  const samples = [];
  let frameMaxRange = 0;

  for (let i = 0; i < pointCount; i += stride) {
    const base = i * pointStep;
    if (base + pointStep > bytes.length) break;

    let x = readFieldValue(dataView, base, xField, littleEndian);
    let y = readFieldValue(dataView, base, yField, littleEndian);
    let z = zField ? readFieldValue(dataView, base, zField, littleEndian) : 0;
    const intensity = hasIntensityField
      ? readFieldValue(dataView, base, intensityField, littleEndian)
      : Number.NaN;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    if (Math.abs(x) > 500 || Math.abs(y) > 500 || Math.abs(z) > 500) {
      x /= 1000;
      y /= 1000;
      z /= 1000;
    }

    const range = Math.hypot(x, y, z);
    if (!Number.isFinite(range) || range < LIDAR_MIN_RANGE_M) continue;

    frameMaxRange = Math.max(frameMaxRange, range);
    samples.push({ x, y, z, intensity, range });
  }

  if (!samples.length) {
    return { points: [], reason: `parsed 0 valid points from ${pointCount}` };
  }

  const points = [];
  for (const sample of samples) {
    if (!shouldKeepLidarPoint(sample.range, sample.intensity, hasIntensityField, frameMaxRange)) {
      continue;
    }

    points.push(rosToScene(sample.x, sample.y, sample.z));
  }

  if (!points.length) {
    return { points: [], reason: `all ${samples.length} points filtered as invalid/max-range` };
  }

  return { points, reason: null };
}

const Mat4 = {
  create() {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  },

  multiply(out, a, b) {
    const a00 = a[0]; const a01 = a[1]; const a02 = a[2]; const a03 = a[3];
    const a10 = a[4]; const a11 = a[5]; const a12 = a[6]; const a13 = a[7];
    const a20 = a[8]; const a21 = a[9]; const a22 = a[10]; const a23 = a[11];
    const a30 = a[12]; const a31 = a[13]; const a32 = a[14]; const a33 = a[15];

    let b0 = b[0]; let b1 = b[1]; let b2 = b[2]; let b3 = b[3];
    out[0] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[5] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[6] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[7] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[9] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[10] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[11] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[13] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[14] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[15] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    return out;
  },

  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    out[10] = (far + near) / (near - far);
    out[14] = (2 * far * near) / (near - far);
    return out;
  },

  lookAt(out, eye, center, up) {
    const ex = eye[0]; const ey = eye[1]; const ez = eye[2];
    const cx = center[0]; const cy = center[1]; const cz = center[2];
    let zx = ex - cx; let zy = ey - cy; let zz = ez - cz;
    let len = Math.hypot(zx, zy, zz);
    if (len === 0) zz = 1;
    else { zx /= len; zy /= len; zz /= len; }

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz);
    if (len === 0) { xx = 1; xy = 0; xz = 0; }
    else { xx /= len; xy /= len; xz /= len; }

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
    return out;
  },
};

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || 'Shader compile failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(info || 'Program link failed');
  }
  return program;
}

function createGridLines(range, step) {
  const positions = [];
  const colors = [];
  const color = [0.35, 0.35, 0.38];

  for (let v = -range; v <= range; v += step) {
    positions.push(-range, 0, v, range, 0, v);
    colors.push(...color, ...color);
    positions.push(v, 0, -range, v, 0, range);
    colors.push(...color, ...color);
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

class LidarViewer {
  constructor(targetCanvas, targetContainer) {
    this.canvas = targetCanvas;
    this.container = targetContainer;
    this.gl = targetCanvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    this.camera = {
      yaw: 0.85,
      pitch: 0.42,
      distance: 28,
      userZoomed: false,
    };

    this.dragMode = null;
    this.lastX = 0;
    this.lastY = 0;
    this.pointCount = 0;
    this.needsRender = true;
    this.rafId = null;

    this.proj = Mat4.create();
    this.view = Mat4.create();
    this.vp = Mat4.create();

    this.initGl();
    this.bindEvents();
    this.resize();
    this.startLoop();
  }

  initGl() {
    const gl = this.gl;

    const pointVertex = `
      attribute vec3 a_position;
      attribute vec3 a_color;
      uniform mat4 u_mvp;
      varying vec3 v_color;
      void main() {
        gl_Position = u_mvp * vec4(a_position, 1.0);
        gl_PointSize = 2.2;
        v_color = a_color;
      }
    `;

    const pointFragment = `
      precision mediump float;
      varying vec3 v_color;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(v_color, 0.88);
      }
    `;

    const lineVertex = `
      attribute vec3 a_position;
      attribute vec3 a_color;
      uniform mat4 u_mvp;
      varying vec3 v_color;
      void main() {
        gl_Position = u_mvp * vec4(a_position, 1.0);
        v_color = a_color;
      }
    `;

    const lineFragment = `
      precision mediump float;
      varying vec3 v_color;
      void main() {
        gl_FragColor = vec4(v_color, 0.45);
      }
    `;

    this.pointProgram = createProgram(gl, pointVertex, pointFragment);
    this.lineProgram = createProgram(gl, lineVertex, lineFragment);

    this.pointPosBuffer = gl.createBuffer();
    this.pointColorBuffer = gl.createBuffer();
    this.linePosBuffer = gl.createBuffer();
    this.lineColorBuffer = gl.createBuffer();

    const grid = createGridLines(30, 5);
    this.lineCount = grid.positions.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, grid.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, grid.colors, gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.027, 0.043, 0.063, 1);
  }

  bindEvents() {
    this.onMouseDown = (event) => {
      if (event.button === 0) {
        this.dragMode = 'rotate';
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        this.dragMode = 'zoom';
        this.lastY = event.clientY;
        this.canvas.style.cursor = 'ns-resize';
      }
    };

    this.onMouseMove = (event) => {
      if (this.dragMode === 'rotate') {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.camera.yaw -= dx * 0.008;
        this.camera.pitch += dy * 0.008;
        this.camera.pitch = Math.max(-1.45, Math.min(1.45, this.camera.pitch));
        this.needsRender = true;
        return;
      }

      if (this.dragMode === 'zoom') {
        const dy = event.clientY - this.lastY;
        this.lastY = event.clientY;
        this.camera.distance *= Math.exp(dy * 0.01);
        this.camera.distance = Math.max(3, Math.min(120, this.camera.distance));
        this.camera.userZoomed = true;
        this.needsRender = true;
      }
    };

    this.onMouseUp = (event) => {
      if (event.button === 0 && this.dragMode === 'rotate') {
        this.dragMode = null;
        this.canvas.style.cursor = 'grab';
      }

      if (event.button === 2 && this.dragMode === 'zoom') {
        this.dragMode = null;
        this.canvas.style.cursor = 'grab';
      }
    };

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.style.cursor = 'grab';
  }

  getEyePosition() {
    const { distance, yaw, pitch } = this.camera;
    const cosPitch = Math.cos(pitch);
    return [
      distance * cosPitch * Math.sin(yaw),
      distance * Math.sin(pitch) + 1.2,
      distance * cosPitch * Math.cos(yaw),
    ];
  }

  updateProjection() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    Mat4.perspective(this.proj, Math.PI / 4, width / height, 0.1, 250);
  }

  updateViewMatrix() {
    const eye = this.getEyePosition();
    Mat4.lookAt(this.view, eye, [0, 0.6, 0], [0, 1, 0]);
    Mat4.multiply(this.vp, this.proj, this.view);
  }

  fitDistanceToPoints(points) {
    if (this.camera.userZoomed || !points.length) return;

    let maxExtent = 0;
    for (const point of points) {
      maxExtent = Math.max(maxExtent, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
    }
    if (maxExtent > 0) {
      this.camera.distance = Math.max(12, maxExtent * 2.4);
      this.needsRender = true;
    }
  }

  setPoints(points) {
    this.pointCount = points.length;
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const offset = i * 3;
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;
      const color = heightColor(point.y);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

    this.fitDistanceToPoints(points);
    this.needsRender = true;
  }

  drawLines() {
    const gl = this.gl;
    gl.useProgram(this.lineProgram);
    const mvpLoc = gl.getUniformLocation(this.lineProgram, 'u_mvp');
    gl.uniformMatrix4fv(mvpLoc, false, this.vp);

    const posLoc = gl.getAttribLocation(this.lineProgram, 'a_position');
    const colorLoc = gl.getAttribLocation(this.lineProgram, 'a_color');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, this.lineCount);
  }

  drawPoints() {
    if (!this.pointCount) return;

    const gl = this.gl;
    gl.useProgram(this.pointProgram);
    const mvpLoc = gl.getUniformLocation(this.pointProgram, 'u_mvp');
    gl.uniformMatrix4fv(mvpLoc, false, this.vp);

    const posLoc = gl.getAttribLocation(this.pointProgram, 'a_position');
    const colorLoc = gl.getAttribLocation(this.pointProgram, 'a_color');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPosBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.pointCount);
  }

  render() {
    this.updateProjection();
    this.updateViewMatrix();

    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    this.drawLines();
    this.drawPoints();
    this.needsRender = false;
  }

  resize() {
    this.needsRender = true;
  }

  startLoop() {
    const tick = () => {
      this.rafId = window.requestAnimationFrame(tick);
      if (this.needsRender || this.dragMode) {
        this.render();
      }
    };
    tick();
  }

  destroy() {
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
  }
}

function ensureViewer() {
  if (viewer) return viewer;
  if (!canvas || !container) {
    throw new Error('Lidar panel not ready');
  }
  viewer = new LidarViewer(canvas, container);
  return viewer;
}

function handlePointCloud(message) {
  messageCount += 1;
  const { points, reason } = parsePointCloud2(message);

  if (!points.length) {
    if (messageCount <= 5) {
      setStatus(`Received · ${reason}`, 'is-error');
    }
    return;
  }

  try {
    const activeViewer = ensureViewer();
    activeViewer.setPoints(points);
    setStatus(`${points.length.toLocaleString()} pts · left drag rotate · right drag zoom`, 'is-live');
  } catch (error) {
    setStatus(error.message || 'Lidar render failed', 'is-error');
  }
}

function startLidar(ros) {
  if (!canvas || !container) {
    setStatus('Lidar panel not ready', 'is-error');
    return;
  }

  try {
    ensureViewer();
  } catch (error) {
    setStatus(error.message || 'Lidar viewer failed', 'is-error');
    return;
  }

  if (lidarTopic) {
    lidarTopic.unsubscribe();
  }

  lidarTopic = new ROSLIB.Topic({
    ros,
    name: LIDAR_TOPIC,
    messageType: DEFAULT_MESSAGE_TYPE,
  });

  lidarTopic.subscribe((message) => {
    handlePointCloud(message);
  });

  setStatus(`Subscribed · ${LIDAR_TOPIC}`, null);
  viewer.needsRender = true;
}

if (container) {
  const resizeObserver = new ResizeObserver(() => {
    if (viewer) viewer.resize();
  });
  resizeObserver.observe(container);
}

window.unitreeLidar = { start: startLidar };
})();
