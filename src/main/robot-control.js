(function () {
  const CMD_VEL_TOPIC = '/cmd_vel';
  const LINEAR_SPEED = 0.6;
  const LATERAL_SPEED = 0.4;
  const ANGULAR_SPEED = 1.0;
  const PUBLISH_HZ = 20;

  const joystickEl = document.getElementById('move-joystick');
  const baseEl = joystickEl?.querySelector('.joystick-base');
  const knobEl = joystickEl?.querySelector('.joystick-knob');

  let joystickActive = false;
  let pointerId = null;
  let maxOffset = 0;
  let joystickValue = { x: 0, y: 0 };
  let cmdVelTopic = null;
  let publishTimer = null;
  const pressedKeys = new Set();

  const stopTwist = {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };

  function clamp(value) {
    return Math.max(-1, Math.min(1, value));
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
    return joystickActive || pressedKeys.size > 0;
  }

  function publishCmdVel(twist) {
    if (!cmdVelTopic) return;
    cmdVelTopic.publish(twist);
  }

  function stopPublishing() {
    if (publishTimer) {
      window.clearInterval(publishTimer);
      publishTimer = null;
    }
  }

  function startPublishing() {
    if (publishTimer || !cmdVelTopic) return;
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

  function updateMaxOffset() {
    if (!baseEl || !knobEl) return;
    const baseSize = baseEl.clientWidth;
    const knobSize = knobEl.clientWidth;
    maxOffset = Math.max(8, (baseSize - knobSize) / 2);
  }

  function setKnobOffset(dx, dy) {
    if (!knobEl) return;

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
    applyVelocity();
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
    if (!baseEl || joystickActive) return;
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
    if (!joystickActive || event.pointerId !== pointerId) return;
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
    event.preventDefault();
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function onKeyDown(event) {
    if (isTypingTarget(event.target)) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;

    if (!pressedKeys.has(event.code)) {
      pressedKeys.add(event.code);
      applyVelocity();
    }
    event.preventDefault();
  }

  function onKeyUp(event) {
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

  function startRobotControl(ros) {
    if (cmdVelTopic) return;

    cmdVelTopic = new ROSLIB.Topic({
      ros,
      name: CMD_VEL_TOPIC,
      messageType: 'geometry_msgs/msg/Twist',
    });
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

  window.unitreeRobotControl = { start: startRobotControl };
})();
