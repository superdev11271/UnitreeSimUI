(function () {
  const CMD_VEL_TOPIC = '/cmd_vel';
  const CMD_CTL_TOPIC = '/cmd_ctl';
  const CMD_STAND_UP = 10001;
  const CMD_STAND_DOWN = 10002;
  const LINEAR_SPEED = 0.6;
  const LATERAL_SPEED = 0.4;
  const ANGULAR_SPEED = 1.0;
  const PUBLISH_HZ = 20;

  const controlsEl = document.querySelector('[data-panel="1"] .robot-controls');
  const joystickEl = document.getElementById('move-joystick');
  const baseEl = joystickEl?.querySelector('.joystick-base');
  const knobEl = joystickEl?.querySelector('.joystick-knob');
  const selectBtn = document.querySelector('[data-panel="1"] .robot-cmd-btn[data-cmd="select"]');
  const startBtn = document.querySelector('[data-panel="1"] .robot-cmd-btn[data-cmd="start"]');
  const commandButtons = document.querySelectorAll('[data-panel="1"] .robot-cmd-btn');

  let joystickActive = false;
  let pointerId = null;
  let maxOffset = 0;
  let joystickValue = { x: 0, y: 0 };
  let movementLocked = false;
  let cmdVelTopic = null;
  let cmdCtlTopic = null;
  let publishTimer = null;
  const pressedKeys = new Set();

  const stopTwist = {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };

  function clamp(value) {
    return Math.max(-1, Math.min(1, value));
  }

  function updateLockUi() {
    controlsEl?.classList.toggle('is-locked', movementLocked);
    selectBtn?.classList.toggle('is-active', movementLocked);
    startBtn?.classList.toggle('is-active', !movementLocked);
  }

  function getKeyboardInput() {
    let forward = 0;
    let yaw = 0;
    let lateral = 0;

    if (pressedKeys.has('KeyW')) forward += 1;
    if (pressedKeys.has('KeyS')) forward -= 1;
    if (pressedKeys.has('KeyA')) yaw += 1;
    if (pressedKeys.has('KeyD')) yaw -= 1;
    if (pressedKeys.has('KeyQ')) lateral += 1;
    if (pressedKeys.has('KeyE')) lateral -= 1;

    return { forward, yaw, lateral };
  }

  function buildTwist() {
    if (movementLocked) {
      return stopTwist;
    }

    const keyboard = getKeyboardInput();
    const joyX = joystickActive ? joystickValue.x : 0;
    const joyY = joystickActive ? joystickValue.y : 0;

    const forward = clamp(joyY + keyboard.forward);
    const yaw = clamp(-joyX + keyboard.yaw);
    const lateral = clamp(keyboard.lateral);

    if (!forward && !yaw && !lateral) {
      return stopTwist;
    }

    return {
      linear: {
        x: forward * LINEAR_SPEED,
        y: lateral * LATERAL_SPEED,
        z: 0,
      },
      angular: { x: 0, y: 0, z: yaw * ANGULAR_SPEED },
    };
  }

  function isControlActive() {
    if (movementLocked) return false;
    return joystickActive || pressedKeys.size > 0;
  }

  function publishCmdVel(twist) {
    if (!cmdVelTopic) return;
    cmdVelTopic.publish(twist);
  }

  function publishCmdCtl(data) {
    if (!cmdCtlTopic) return;
    cmdCtlTopic.publish({ data });
  }

  function stopPublishing() {
    if (publishTimer) {
      window.clearInterval(publishTimer);
      publishTimer = null;
    }
  }

  function startPublishing() {
    if (publishTimer || !cmdVelTopic || movementLocked) return;
    publishTimer = window.setInterval(() => {
      publishCmdVel(buildTwist());
    }, 1000 / PUBLISH_HZ);
  }

  function applyVelocity() {
    publishCmdVel(buildTwist());

    if (isControlActive()) {
      startPublishing();
    } else {
      stopPublishing();
    }
  }

  function lockMovement() {
    movementLocked = true;
    resetKnob();
    pressedKeys.clear();
    publishCmdVel(stopTwist);
    stopPublishing();
    updateLockUi();
  }

  function unlockMovement() {
    movementLocked = false;
    updateLockUi();
  }

  function updateMaxOffset() {
    if (!baseEl || !knobEl) return;
    const baseSize = baseEl.clientWidth;
    const knobSize = knobEl.clientWidth;
    maxOffset = Math.max(8, (baseSize - knobSize) / 2);
  }

  function setKnobOffset(dx, dy) {
    if (!knobEl || movementLocked) return;

    const distance = Math.hypot(dx, dy);
    if (distance > maxOffset) {
      const scale = maxOffset / distance;
      dx *= scale;
      dy *= scale;
    }

    knobEl.style.left = `calc(50% + ${dx}px)`;
    knobEl.style.top = `calc(50% + ${dy}px)`;
    joystickValue = {
      x: maxOffset ? dx / maxOffset : 0,
      y: maxOffset ? -dy / maxOffset : 0,
    };
    applyVelocity();
  }

  function resetKnob() {
    if (knobEl) {
      knobEl.style.left = '50%';
      knobEl.style.top = '50%';
    }
    joystickValue = { x: 0, y: 0 };
    joystickActive = false;
    pointerId = null;
    joystickEl?.classList.remove('is-active');
  }

  function pointerPosition(event) {
    const rect = baseEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      dx: event.clientX - centerX,
      dy: event.clientY - centerY,
    };
  }

  function onPointerDown(event) {
    if (!baseEl || joystickActive || movementLocked) return;
    joystickActive = true;
    pointerId = event.pointerId;
    joystickEl.classList.add('is-active');
    updateMaxOffset();
    baseEl.setPointerCapture(event.pointerId);
    const { dx, dy } = pointerPosition(event);
    setKnobOffset(dx, dy);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!joystickActive || event.pointerId !== pointerId || movementLocked) return;
    const { dx, dy } = pointerPosition(event);
    setKnobOffset(dx, dy);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!joystickActive || event.pointerId !== pointerId) return;
    if (baseEl.hasPointerCapture(event.pointerId)) {
      baseEl.releasePointerCapture(event.pointerId);
    }
    resetKnob();
    applyVelocity();
    event.preventDefault();
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function onKeyDown(event) {
    if (movementLocked || isTypingTarget(event.target)) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;

    if (!pressedKeys.has(event.code)) {
      pressedKeys.add(event.code);
      applyVelocity();
    }
    event.preventDefault();
  }

  function onKeyUp(event) {
    if (movementLocked) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;

    if (pressedKeys.delete(event.code)) {
      applyVelocity();
    }
    event.preventDefault();
  }

  function clearKeyboard() {
    if (!pressedKeys.size) return;
    pressedKeys.clear();
    applyVelocity();
  }

  function flashButton(button) {
    button.classList.add('is-pressed');
    window.setTimeout(() => {
      button.classList.remove('is-pressed');
    }, 150);
  }

  function onCommandClick(event) {
    const button = event.currentTarget;
    const cmd = button.dataset.cmd;
    if (!cmd) return;

    if (cmd === 'select') {
      lockMovement();
    } else if (cmd === 'start') {
      unlockMovement();
    } else if (cmd === 'stand-up') {
      publishCmdCtl(CMD_STAND_UP);
    } else if (cmd === 'stand-down') {
      publishCmdCtl(CMD_STAND_DOWN);
    }

    flashButton(button);
  }

  function ensureCmdCtlTopic(ros) {
    if (!cmdCtlTopic) {
      cmdCtlTopic = new ROSLIB.Topic({
        ros,
        name: CMD_CTL_TOPIC,
        messageType: 'std_msgs/msg/Int32',
      });
    }
  }

  function startRobotControl(ros) {
    if (!cmdVelTopic) {
      cmdVelTopic = new ROSLIB.Topic({
        ros,
        name: CMD_VEL_TOPIC,
        messageType: 'geometry_msgs/msg/Twist',
      });
    }

    ensureCmdCtlTopic(ros);
  }

  if (baseEl && knobEl) {
    baseEl.addEventListener('pointerdown', onPointerDown);
    baseEl.addEventListener('pointermove', onPointerMove);
    baseEl.addEventListener('pointerup', onPointerUp);
    baseEl.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', updateMaxOffset);
    const resizeObserver = new ResizeObserver(updateMaxOffset);
    resizeObserver.observe(baseEl);
    updateMaxOffset();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeyboard);

  commandButtons.forEach((button) => {
    button.addEventListener('click', onCommandClick);
  });

  updateLockUi();

  window.unitreeRobotControl = { start: startRobotControl };
})();
