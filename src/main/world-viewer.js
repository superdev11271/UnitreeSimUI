import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WORLD_MODEL_FALLBACK_URL = '../assets/world.glb';
const ROBOT_MODEL_FALLBACK_URL = '../assets/b2.glb';
const WORLD_POSE_TOPIC = '/world_pose';
const WORLD_POSE_TYPE = 'nav_msgs/msg/Odometry';
const JOINT_STATES_TOPIC = '/joint_states';
const JOINT_STATES_TYPE = 'sensor_msgs/msg/JointState';
const LOAD_TIMEOUT_MS = 15000;
const TRANSPARENT_OPACITY = 0.22;
const EDGE_THRESHOLD_DEG = 24;
const EDGE_COLOR = 0xa8d4c8;
const EDGE_OPACITY = 0.92;
const EDGE_RENDER_ORDER = 50;
const AXIS_BASE_LENGTH = 1;
const AXIS_SCREEN_PX = 28;
const AXIS_RENDER_ORDER = 9999;
const ROBOT_RENDER_ORDER = 9998;
const RATE_INTERVAL_MS = 1000;

function createRateTracker(onTick) {
  let count = 0;
  let rate = 0;
  let windowStart = 0;
  let timerId = null;

  function flushWindow(now = performance.now()) {
    if (!windowStart) {
      windowStart = now;
      return;
    }

    const elapsedSec = (now - windowStart) / 1000;
    rate = elapsedSec > 0 ? count / elapsedSec : 0;
    count = 0;
    windowStart = now;
    onTick(rate);
  }

  return {
    record() {
      count += 1;
    },
    start() {
      this.stop();
      windowStart = performance.now();
      count = 0;
      rate = 0;
      timerId = window.setInterval(() => {
        flushWindow();
      }, RATE_INTERVAL_MS);
    },
    stop() {
      if (timerId) {
        window.clearInterval(timerId);
        timerId = null;
      }
      count = 0;
      rate = 0;
      windowStart = 0;
    },
    getRate() {
      return rate;
    },
  };
}

const LEG_PREFIXES = ['FL', 'FR', 'RL', 'RR'];

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const JOINT_BINDINGS = [
  { name: 'FL_hip_joint', axis: AXIS_X, sign: 1 },
  { name: 'FL_thigh_joint', axis: AXIS_Z, sign: -1 },
  { name: 'FL_calf_joint', axis: AXIS_Z, sign: -1 },
  { name: 'FR_hip_joint', axis: AXIS_X, sign: 1 },
  { name: 'FR_thigh_joint', axis: AXIS_Z, sign: -1 },
  { name: 'FR_calf_joint', axis: AXIS_Z, sign: -1 },
  { name: 'RL_hip_joint', axis: AXIS_X, sign: 1 },
  { name: 'RL_thigh_joint', axis: AXIS_Z, sign: -1 },
  { name: 'RL_calf_joint', axis: AXIS_Z, sign: -1 },
  { name: 'RR_hip_joint', axis: AXIS_X, sign: 1 },
  { name: 'RR_thigh_joint', axis: AXIS_Z, sign: -1 },
  { name: 'RR_calf_joint', axis: AXIS_Z, sign: -1 },
];

const ROS_TO_THREE_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);

const container = document.getElementById('world-viewer');
const statusEl = document.getElementById('world-status');
const viewModeBtn = document.getElementById('world-view-mode-btn');
const focusRobotBtn = document.getElementById('world-focus-robot-btn');
const followBtn = document.getElementById('world-follow-btn');
const robotViewBtn = document.getElementById('world-robot-view-btn');

function setStatus(text, state, rate = null) {
  if (!statusEl) return;
  if (window.unitreeSensorStatus?.setPanelStatus) {
    window.unitreeSensorStatus.setPanelStatus(statusEl, text, { state, rate });
    return;
  }
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

async function loadRobotModelBuffer() {
  if (window.unitreeSim?.readRobotModel) {
    const data = await window.unitreeSim.readRobotModel();
    return toArrayBuffer(data);
  }

  const response = await fetch(ROBOT_MODEL_FALLBACK_URL);
  if (!response.ok) {
    throw new Error(`Could not read b2.glb (${response.status})`);
  }
  return response.arrayBuffer();
}

function cloneMaterialList(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone());
  }
  return material.clone();
}

function getMaterialColor(material) {
  if (material.color?.isColor) {
    return material.color;
  }
  return new THREE.Color(0x8b95a8);
}

function createTransparentMaterial(material) {
  const transparent = new THREE.MeshBasicMaterial({
    color: getMaterialColor(material).clone(),
    transparent: true,
    opacity: TRANSPARENT_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  if (material.map) {
    transparent.map = material.map;
    transparent.map.colorSpace = material.map.colorSpace ?? THREE.SRGBColorSpace;
  }

  return transparent;
}

function createMeshEdgeLines(mesh) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG);
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  lines.renderOrder = EDGE_RENDER_ORDER;
  lines.visible = false;
  mesh.add(lines);
  return lines;
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

function configureRobotAxesMaterials(axes) {
  axes.renderOrder = AXIS_RENDER_ORDER;
  axes.traverse((object) => {
    if (!object.material) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.depthTest = true;
      material.fog = false;
      if ('toneMapped' in material) {
        material.toneMapped = false;
      }
    }

    object.renderOrder = AXIS_RENDER_ORDER;
  });
}

function configureRobotModelMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    object.renderOrder = ROBOT_RENDER_ORDER;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.depthTest = true;
      material.fog = false;
    }
  });
}

function rebuildLegHierarchy(robotRoot) {
  const baseLink = robotRoot.getObjectByName('base_link');
  if (!baseLink) return false;

  robotRoot.updateMatrixWorld(true);
  const pivot = new THREE.Vector3();

  for (const leg of LEG_PREFIXES) {
    const hipJoint = robotRoot.getObjectByName(`${leg}_hip_joint`);
    const hip = robotRoot.getObjectByName(`${leg}_hip`);
    const thighJoint = robotRoot.getObjectByName(`${leg}_thigh_joint`);
    const thigh = robotRoot.getObjectByName(`${leg}_thigh`);
    const protectJoint = robotRoot.getObjectByName(`${leg}_thigh_protect_joint`);
    const protect = robotRoot.getObjectByName(`${leg}_thigh_protect`);
    const calfJoint = robotRoot.getObjectByName(`${leg}_calf_joint`);
    const calf = robotRoot.getObjectByName(`${leg}_calf`);
    const footJoint = robotRoot.getObjectByName(`${leg}_foot_joint`);
    const foot = robotRoot.getObjectByName(`${leg}_foot`);

    if (hipJoint && hip) {
      hip.getWorldPosition(pivot);
      baseLink.worldToLocal(pivot);
      hipJoint.position.copy(pivot);
      hipJoint.attach(hip);
    }

    if (thighJoint && thigh && hipJoint) {
      thigh.getWorldPosition(pivot);
      hipJoint.worldToLocal(pivot);
      thighJoint.position.copy(pivot);
      hipJoint.attach(thighJoint);
      thighJoint.attach(thigh);
    }

    if (protectJoint && protect && thigh) {
      protect.getWorldPosition(pivot);
      thigh.worldToLocal(pivot);
      protectJoint.position.copy(pivot);
      protectJoint.attach(protect);
    }

    if (calfJoint && calf && thighJoint) {
      calf.getWorldPosition(pivot);
      thighJoint.worldToLocal(pivot);
      calfJoint.position.copy(pivot);
      thighJoint.attach(calfJoint);
      calfJoint.attach(calf);
    }

    if (footJoint && foot && calfJoint) {
      foot.getWorldPosition(pivot);
      calfJoint.worldToLocal(pivot);
      footJoint.position.copy(pivot);
      calfJoint.attach(footJoint);
      footJoint.attach(foot);
    }
  }

  return true;
}

function buildJointMap(robotRoot) {
  const jointMap = new Map();

  for (const binding of JOINT_BINDINGS) {
    const joint = robotRoot.getObjectByName(binding.name);
    if (!joint) continue;
    jointMap.set(binding.name, {
      joint,
      axis: binding.axis,
      sign: binding.sign ?? 1,
    });
  }

  return jointMap;
}

function applyJointAngle(joint, axis, angle, sign = 1) {
  joint.quaternion.setFromAxisAngle(axis, angle * sign);
}

function alignRobotModel(robotModel) {
  // /world_pose applies ROS Z-up -> Three Y-up on robotMarker. The glTF mesh is
  // already Y-up, so cancel that extra -90deg X tilt for the visual model only.
  robotModel.rotation.set(Math.PI / 2, 0, 0);
}

class WorldViewer {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b10);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(10, 8, 10);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: true,
    });
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
    this.controls.zoomSpeed = 6;
    this.controls.addEventListener('start', (event) => {
      if (event?.mode === 'pan') {
        this.orbitAroundRobot = false;
        if (this.followMode) {
          this.setFollowMode(false);
        }
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
    configureRobotAxesMaterials(this.robotAxes);
    this.robotModel = new THREE.Group();
    this.robotModel.visible = false;
    this.robotMarker.add(this.robotModel);
    this.scene.add(this.robotMarker);

    this.poseTopic = null;
    this.jointStatesTopic = null;
    this.ros = null;
    this.isSubscribed = false;
    this.hasPose = false;
    this.hasJointStates = false;
    this.robotModelReady = false;
    this.robotViewMode = 'axis';
    this.jointMap = new Map();
    this.lastJointStatesMessage = null;
    this.lastStatusPosition = null;
    this.poseRateTracker = createRateTracker((hz) => {
      if (!this.isSubscribed) return;
      this.updateLiveStatus(hz);
    });
    this.orbitAroundRobot = false;
    this.followMode = false;
    this.meshes = [];
    this.transparentView = false;
    this._ndc = new THREE.Vector2();
    this._followDelta = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane();
    this._viewDir = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this._cameraOffset = new THREE.Vector3();
    this._sceneFar = 2000;
    this.onOrbitPointerDown = this.onOrbitPointerDown.bind(this);
    this.rafId = null;
    this.onResize = () => this.resize();
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.host);

    this.loadModel();
    this.loadRobotModel();
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
      if (!object.userData.edgeLines) {
        object.userData.edgeLines = createMeshEdgeLines(object);
      }
      this.meshes.push(object);
    });
  }

  setEdgeLinesVisible(visible) {
    for (const mesh of this.meshes) {
      if (mesh.userData.edgeLines) {
        mesh.userData.edgeLines.visible = visible;
      }
    }
  }

  updateViewModeButton() {
    if (viewModeBtn) {
      viewModeBtn.disabled = this.meshes.length === 0;
      viewModeBtn.classList.toggle('is-transparent', this.transparentView);
      viewModeBtn.setAttribute(
        'aria-label',
        this.transparentView ? 'Normal view' : 'Transparent view',
      );
      viewModeBtn.setAttribute(
        'aria-pressed',
        this.transparentView ? 'true' : 'false',
      );
    }
  }

  updateFollowButton() {
    if (!followBtn) return;

    followBtn.classList.toggle('is-follow', this.followMode);
    followBtn.setAttribute(
      'aria-label',
      this.followMode ? 'Normal camera mode' : 'Follow robot',
    );
    followBtn.setAttribute(
      'aria-pressed',
      this.followMode ? 'true' : 'false',
    );
  }

  updateRobotViewButton() {
    if (!robotViewBtn) return;

    const robotMode = this.robotViewMode === 'robot';
    robotViewBtn.classList.toggle('is-robot-view', robotMode);
    robotViewBtn.setAttribute(
      'aria-label',
      robotMode ? 'Axis view' : 'Robot model view',
    );
    robotViewBtn.setAttribute(
      'aria-pressed',
      robotMode ? 'true' : 'false',
    );
  }

  updateRobotDisplay() {
    const showRobotModel = this.robotViewMode === 'robot' && this.robotModelReady;
    this.robotAxes.visible = !showRobotModel;
    this.robotModel.visible = showRobotModel && this.hasPose;
  }

  setRobotViewMode(mode) {
    if (mode !== 'axis' && mode !== 'robot') return;
    this.robotViewMode = mode;
    this.updateRobotDisplay();
    this.updateRobotViewButton();
  }

  toggleRobotViewMode() {
    this.setRobotViewMode(this.robotViewMode === 'axis' ? 'robot' : 'axis');
  }

  applyFollowMode() {
    if (!this.followMode || !this.hasPose) return;

    const robotPosition = this.robotMarker.position;
    this._followDelta.copy(robotPosition).sub(this.controls.target);
    if (this._followDelta.lengthSq() === 0) return;

    this.controls.target.copy(robotPosition);
    this.camera.position.add(this._followDelta);
  }

  setFollowMode(enabled) {
    this.followMode = enabled;

    if (enabled) {
      this.orbitAroundRobot = true;
      if (this.hasPose) {
        this.applyFollowMode();
      }
    }

    this.updateFollowButton();
  }

  toggleFollowMode() {
    this.setFollowMode(!this.followMode);
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
    this.setEdgeLinesVisible(enabled);
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

    if ((this.followMode || this.orbitAroundRobot) && this.hasPose) {
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
    this._sceneFar = Math.max(500, maxDim * 20);
    this.updateCameraClipPlanes(true);
    this.controls.update();
  }

  updateCameraClipPlanes(force = false) {
    const distance = Math.max(0.1, this.camera.position.distanceTo(this.controls.target));
    const near = Math.max(0.02, distance * 0.002);
    const far = Math.max(this._sceneFar, distance * 12);

    if (!force && Math.abs(this.camera.near - near) < near * 0.05 && Math.abs(this.camera.far - far) < far * 0.05) {
      return;
    }

    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  updateRobotAxesScreenScale() {
    if (!this.robotMarker.visible || this.robotViewMode !== 'axis') return;

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
    this.lastRosPose = {
      position: {
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z,
      },
      orientation: {
        x: pose.orientation.x,
        y: pose.orientation.y,
        z: pose.orientation.z,
        w: pose.orientation.w,
      },
    };
    this.lastStatusPosition = position;
    this.poseRateTracker.record();
    this.updateRobotDisplay();
    this.updateRobotAxesScreenScale();
    if (this.followMode) {
      this.applyFollowMode();
    }
    this.updateLiveStatus();
  }

  updateLiveStatus(rateOverride = null) {
    if (!this.isSubscribed) return;

    const rate = rateOverride ?? this.poseRateTracker.getRate();
    if (this.hasPose && this.lastStatusPosition) {
      const position = this.lastStatusPosition;
      setStatus(
        `Robot x:${position.x.toFixed(2)} y:${position.y.toFixed(2)} z:${position.z.toFixed(2)}`,
        'is-live',
        rate,
      );
      return;
    }

    setStatus('Waiting for robot pose…', null, rate);
  }

  updateJointStates(message) {
    if (!message) return;
    this.lastJointStatesMessage = message;

    const names = message.name;
    const positions = message.position;
    if (!Array.isArray(names) || !Array.isArray(positions) || !this.jointMap.size) return;

    for (let index = 0; index < names.length; index += 1) {
      const binding = this.jointMap.get(names[index]);
      if (!binding) continue;
      applyJointAngle(binding.joint, binding.axis, positions[index] ?? 0, binding.sign);
    }

    this.hasJointStates = true;
  }

  ensurePoseTopics(ros) {
    if (!this.poseTopic) {
      this.poseTopic = new ROSLIB.Topic({
        ros,
        name: WORLD_POSE_TOPIC,
        messageType: WORLD_POSE_TYPE,
      });
    }

    if (!this.jointStatesTopic) {
      this.jointStatesTopic = new ROSLIB.Topic({
        ros,
        name: JOINT_STATES_TOPIC,
        messageType: JOINT_STATES_TYPE,
      });
    }
  }

  subscribePoseTopics() {
    if (!this.poseTopic || !this.jointStatesTopic) return;

    this.poseTopic.subscribe((message) => {
      this.updateRobotPose(message);
    });

    this.jointStatesTopic.subscribe((message) => {
      this.updateJointStates(message);
    });

    if (this.lastJointStatesMessage) {
      this.updateJointStates(this.lastJointStatesMessage);
    }

    if (!this.hasPose) {
      setStatus('Waiting for robot pose…', null);
    }
  }

  unsubscribePoseTopics() {
    if (this.poseTopic) this.poseTopic.unsubscribe();
    if (this.jointStatesTopic) this.jointStatesTopic.unsubscribe();
  }

  getCurrentRosPose() {
    if (!this.lastRosPose) return null;
    return {
      position: { ...this.lastRosPose.position },
      orientation: { ...this.lastRosPose.orientation },
    };
  }

  clearPanelData() {
    this.robotMarker.visible = false;
    this.hasPose = false;
    this.hasJointStates = false;
    this.lastRosPose = null;

    for (const binding of this.jointMap.values()) {
      binding.joint.quaternion.identity();
    }

    this.updateRobotDisplay();
  }

  setSubscribed(active) {
    if (!this.ros) return;

    if (active && !this.isSubscribed) {
      this.subscribePoseTopics();
      this.poseRateTracker.start();
      this.isSubscribed = true;
      this.updateLiveStatus(0);
      return;
    }

    if (!active) {
      if (this.isSubscribed) {
        this.unsubscribePoseTopics();
      }
      this.poseRateTracker.stop();
      this.clearPanelData();
      this.lastStatusPosition = null;
      this.isSubscribed = false;
      setStatus('Disabled', null, null);
    }
  }

  startJointStates(ros) {
    this.ensurePoseTopics(ros);
  }

  startPose(ros) {
    if (!ros) return;

    this.ros = ros;
    this.ensurePoseTopics(ros);
  }

  async loadRobotModel() {
    try {
      const buffer = await withTimeout(
        loadRobotModelBuffer(),
        LOAD_TIMEOUT_MS,
        'Timed out loading b2.glb',
      );

      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(buffer, 'b2.glb');

      const robotRoot = gltf.scene;
      rebuildLegHierarchy(robotRoot);

      this.robotModel.clear();
      this.robotModel.add(robotRoot);
      configureRobotModelMaterials(this.robotModel);
      alignRobotModel(this.robotModel);
      this.jointMap = buildJointMap(robotRoot);
      this.robotModelReady = this.jointMap.size > 0;
      if (this.lastJointStatesMessage) {
        this.updateJointStates(this.lastJointStatesMessage);
      }
      this.updateRobotDisplay();
      this.updateRobotViewButton();
    } catch (error) {
      console.warn('Failed to load b2.glb', error);
      this.robotModelReady = false;
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
        this.updateLiveStatus();
      } else if (this.isSubscribed) {
        setStatus('Waiting for robot pose…', null, this.poseRateTracker.getRate());
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

  renderTransparentWithAxesOverlay() {
    this.renderer.render(this.scene, this.camera);

    const previousAutoClear = this.renderer.autoClear;
    const previousBackground = this.scene.background;
    this.scene.background = null;
    this.modelRoot.visible = false;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.modelRoot.visible = true;
    this.scene.background = previousBackground;
    this.renderer.autoClear = previousAutoClear;
  }

  render() {
    this.applyFollowMode();
    this.updateRobotAxesScreenScale();
    this.controls.update();
    this.updateCameraClipPlanes();

    if (this.transparentView && this.robotMarker.visible) {
      this.renderTransparentWithAxesOverlay();
      return;
    }

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
    if (this.jointStatesTopic) this.jointStatesTopic.unsubscribe();
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
  followBtn?.addEventListener('click', () => {
    viewer.toggleFollowMode();
  });
  robotViewBtn?.addEventListener('click', () => {
    viewer.toggleRobotViewMode();
  });
  window.unitreeWorld = {
    start: (ros) => viewer.startPose(ros),
    setSubscribed: (active) => viewer.setSubscribed(active),
    getCurrentRosPose: () => viewer.getCurrentRosPose(),
  };
} else {
  setStatus('World viewer panel not ready', 'is-error');
}
