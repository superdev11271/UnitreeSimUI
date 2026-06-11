import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WORLD_MODEL_FALLBACK_URL = '../assets/world.glb';
const WORLD_POSE_TOPIC = '/world_pose';
const WORLD_POSE_TYPE = 'nav_msgs/msg/Odometry';
const LOAD_TIMEOUT_MS = 15000;
const TRANSPARENT_OPACITY = 0.28;
const AXIS_BASE_LENGTH = 1;
const AXIS_SCREEN_PX = 28;

const ROS_TO_THREE_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);

const container = document.querySelector('[data-panel="4"] .world-viewer-host');
const statusEl = document.getElementById('world-status');
const viewModeBtn = document.getElementById('world-view-mode-btn');
const focusRobotBtn = document.getElementById('world-focus-robot-btn');

function setStatus(text, state) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-live', 'is-error');
  if (state) statusEl.classList.add(state);
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

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  throw new Error('Invalid world model data');
}

async function loadWorldModelBuffer() {
  if (window.unitreeSim?.readWorldModel) {
    const data = await window.unitreeSim.readWorldModel();
    return toArrayBuffer(data);
  }

  const response = await fetch(WORLD_MODEL_FALLBACK_URL);
  if (!response.ok) {
    throw new Error(`Could not read world.glb (${response.status})`);
  }
  return response.arrayBuffer();
}

function cloneMaterialList(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone());
  }
  return material.clone();
}

function createTransparentMaterial(material) {
  const transparent = material.clone();
  transparent.transparent = true;
  transparent.opacity = TRANSPARENT_OPACITY;
  transparent.depthWrite = false;
  transparent.side = THREE.DoubleSide;
  return transparent;
}

function rosPoseToThree(pose) {
  const position = new THREE.Vector3(
    pose.position.x,
    pose.position.z,
    -pose.position.y,
  );
  const orientation = new THREE.Quaternion(
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  );
  orientation.premultiply(ROS_TO_THREE_QUAT);
  return { position, orientation };
}

function createRobotMarker() {
  const root = new THREE.Group();
  const axes = new THREE.Group();
  const axisSpecs = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff0000 },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x00ff00 },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x0000ff },
  ];

  for (const spec of axisSpecs) {
    const arrow = new THREE.ArrowHelper(
      spec.dir,
      new THREE.Vector3(0, 0, 0),
      AXIS_BASE_LENGTH,
      spec.color,
      AXIS_BASE_LENGTH * 0.18,
      AXIS_BASE_LENGTH * 0.1,
    );
    axes.add(arrow);
  }

  root.add(axes);
  root.visible = false;
  return { root, axes };
}

function configureRobotAxesMaterials(axes, overlay) {
  axes.traverse((object) => {
    if (!object.material) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = !overlay;
      material.depthTest = !overlay;
      material.fog = false;
      if ('toneMapped' in material) {
        material.toneMapped = false;
      }
    }

    object.renderOrder = overlay ? 1000 : 20;
  });
}

class WorldViewer {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b10);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(10, 8, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.sortObjects = true;
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    };
    this.controls.addEventListener('start', (event) => {
      if (event?.mode === 'pan') {
        this.orbitAroundRobot = false;
      }
    });
    this.renderer.domElement.addEventListener('pointerdown', this.onOrbitPointerDown, true);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(8, 14, 6);
    const fillLight = new THREE.DirectionalLight(0x88bbff, 0.35);
    fillLight.position.set(-6, 4, -8);
    this.scene.add(ambient, keyLight, fillLight);

    this.grid = new THREE.GridHelper(40, 40, 0x3a4554, 0x1a2230);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    const robotMarkerParts = createRobotMarker();
    this.robotMarker = robotMarkerParts.root;
    this.robotAxes = robotMarkerParts.axes;
    configureRobotAxesMaterials(this.robotAxes, false);
    this.scene.add(this.robotMarker);

    this.poseTopic = null;
    this.hasPose = false;
    this.orbitAroundRobot = false;
    this.meshes = [];
    this.transparentView = false;
    this._ndc = new THREE.Vector2();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane();
    this._viewDir = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this._cameraOffset = new THREE.Vector3();
    this.onOrbitPointerDown = this.onOrbitPointerDown.bind(this);
    this.rafId = null;
    this.onResize = () => this.resize();
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.host);

    this.loadModel();
    this.resize();
    this.startLoop();
  }

  prepareModelMaterials(root) {
    this.meshes = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.material || object.userData.skipTransparent) return;

      const normalMaterials = cloneMaterialList(object.material);
      const transparentMaterials = Array.isArray(normalMaterials)
        ? normalMaterials.map(createTransparentMaterial)
        : createTransparentMaterial(normalMaterials);

      object.userData.normalMaterials = normalMaterials;
      object.userData.transparentMaterials = transparentMaterials;
      this.meshes.push(object);
    });
  }

  updateViewModeButton() {
    if (viewModeBtn) {
      viewModeBtn.disabled = this.meshes.length === 0;
      viewModeBtn.textContent = this.transparentView ? 'Normal View' : 'Transparent View';
      viewModeBtn.classList.toggle('is-active', this.transparentView);
      viewModeBtn.setAttribute(
        'aria-pressed',
        this.transparentView ? 'true' : 'false',
      );
    }
  }

  focusOnRobot() {
    if (!this.hasPose) return;

    const robotPosition = this.robotMarker.position;
    const offset = this._cameraOffset.copy(this.camera.position).sub(this.controls.target);

    if (offset.lengthSq() < 1) {
      offset.set(6, 4, 6);
    }

    const distance = THREE.MathUtils.clamp(
      this.camera.position.distanceTo(robotPosition),
      4,
      50,
    );
    offset.normalize().multiplyScalar(distance);

    this.controls.target.copy(robotPosition);
    this.camera.position.copy(robotPosition).add(offset);
    this.orbitAroundRobot = true;
    configureRobotAxesMaterials(this.robotAxes, this.transparentView);
    this.controls.update();
  }

  setTransparentView(enabled) {
    this.transparentView = enabled;

    for (const mesh of this.meshes) {
      mesh.material = enabled
        ? mesh.userData.transparentMaterials
        : mesh.userData.normalMaterials;
    }

    this.grid.visible = !enabled;
    configureRobotAxesMaterials(this.robotAxes, enabled);
    this.updateViewModeButton();
  }

  toggleViewMode() {
    if (!this.meshes.length) return;
    this.setTransparentView(!this.transparentView);
  }

  getViewportCenterWorldPoint(out = this._hitPoint) {
    this._ndc.set(0, 0);
    this._raycaster.setFromCamera(this._ndc, this.camera);

    const hits = this._raycaster.intersectObject(this.modelRoot, true);
    if (hits.length) {
      return out.copy(hits[0].point);
    }

    this.camera.getWorldDirection(this._viewDir);
    this._plane.setFromNormalAndCoplanarPoint(this._viewDir, this.controls.target);
    if (this._raycaster.ray.intersectPlane(this._plane, out)) {
      return out;
    }

    return out.copy(this.controls.target);
  }

  onOrbitPointerDown(event) {
    if (event.button !== 0) return;

    if (this.orbitAroundRobot && this.hasPose) {
      this.controls.target.copy(this.robotMarker.position);
      return;
    }

    this.getViewportCenterWorldPoint(this.controls.target);
  }

  fitCameraToModel(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const distance = maxDim * 0.35;

    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + distance,
      center.y + distance * 0.65,
      center.z + distance,
    );
    this.camera.near = Math.max(0.01, maxDim / 200);
    this.camera.far = Math.max(500, maxDim * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  updateRobotAxesScreenScale() {
    if (!this.robotMarker.visible) return;

    const distance = this.camera.position.distanceTo(this.robotMarker.position);
    if (distance <= 0) return;

    const vFov = this.camera.fov * (Math.PI / 180);
    const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
    const scale = (AXIS_SCREEN_PX / Math.max(1, this.host.clientHeight))
      * visibleHeight
      / AXIS_BASE_LENGTH;
    this.robotAxes.scale.setScalar(scale);
  }

  updateRobotPose(message) {
    const pose = message?.pose?.pose;
    if (!pose?.position || !pose?.orientation) return;

    const { position, orientation } = rosPoseToThree(pose);
    this.robotMarker.position.copy(position);
    this.robotMarker.quaternion.copy(orientation);
    this.robotMarker.visible = true;
    this.hasPose = true;
    this.updateRobotAxesScreenScale();
    this.updateLiveStatus(position);
  }

  updateLiveStatus(position) {
    if (!this.hasPose) return;
    setStatus(
      `Robot x:${position.x.toFixed(2)} y:${position.y.toFixed(2)} z:${position.z.toFixed(2)} · left rotate · right zoom · middle pan`,
      'is-live',
    );
  }

  startPose(ros) {
    if (!ros || this.poseTopic) return;

    this.poseTopic = new ROSLIB.Topic({
      ros,
      name: WORLD_POSE_TOPIC,
      messageType: WORLD_POSE_TYPE,
    });

    this.poseTopic.subscribe((message) => {
      this.updateRobotPose(message);
    });

    if (!this.hasPose) {
      setStatus(`Subscribed · ${WORLD_POSE_TOPIC}`, null);
    }
  }

  async loadModel() {
    setStatus('Loading world model…');
    this.updateViewModeButton();

    try {
      const buffer = await withTimeout(
        loadWorldModelBuffer(),
        LOAD_TIMEOUT_MS,
        'Timed out loading world.glb',
      );

      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(buffer, 'world.glb');

      this.modelRoot.clear();
      this.modelRoot.add(gltf.scene);
      this.prepareModelMaterials(this.modelRoot);
      this.setTransparentView(false);
      this.fitCameraToModel(this.modelRoot);
      if (this.hasPose) {
        this.updateLiveStatus(this.robotMarker.position);
      } else {
        setStatus('World model loaded · waiting for /world_pose', 'is-live');
      }
      this.resize();
    } catch (error) {
      setStatus(error?.message || 'Failed to load world.glb', 'is-error');
      this.updateViewModeButton();
    }
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render() {
    this.updateRobotAxesScreenScale();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  startLoop() {
    const tick = () => {
      this.rafId = window.requestAnimationFrame(tick);
      this.render();
    };
    tick();
  }

  destroy() {
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    if (this.poseTopic) this.poseTopic.unsubscribe();
    this.renderer.domElement.removeEventListener('pointerdown', this.onOrbitPointerDown, true);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

if (container) {
  const viewer = new WorldViewer(container);
  focusRobotBtn?.addEventListener('click', () => {
    viewer.focusOnRobot();
  });
  viewModeBtn?.addEventListener('click', () => {
    viewer.toggleViewMode();
  });
  window.unitreeWorld = { start: (ros) => viewer.startPose(ros) };
} else {
  setStatus('World viewer panel not ready', 'is-error');
}
