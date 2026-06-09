(function () {
  const CMD_VEL_TOPIC = '/cmd_vel';
  const LINEAR_SPEED = 0.6;
  const ANGULAR_SPEED = 1.0;
  const PUBLISH_HZ = 20;

  const joystickEl = document.getElementById('move-joystick');
  if (!joystickEl) return;

  const baseEl = joystickEl.querySelector('.joystick-base');
  const knobEl = joystickEl.querySelector('.joystick-knob');
  if (!baseEl || !knobEl) return;

  let active = false;
  let pointerId = null;
  let maxOffset = 0;
  let value = { x: 0, y: 0 };
  let cmdVelTopic = null;
  let publishTimer = null;

  const stopTwist = {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };

  function joystickToTwist(x, y) {
    return {
      linear: {
        x: y * LINEAR_SPEED,
        y: 0,
        z: 0,
      },
      angular: { x: 0, y: 0, z: -x * ANGULAR_SPEED },
    };
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
      publishCmdVel(joystickToTwist(value.x, value.y));
    }, 1000 / PUBLISH_HZ);
  }

  function applyVelocity() {
    const twist = active ? joystickToTwist(value.x, value.y) : stopTwist;
    publishCmdVel(twist);

    if (active) {
      startPublishing();
    } else {
      stopPublishing();
    }
  }

  function updateMaxOffset() {
    const baseSize = baseEl.clientWidth;
    const knobSize = knobEl.clientWidth;
    maxOffset = Math.max(8, (baseSize - knobSize) / 2);
  }

  function setKnobOffset(dx, dy) {
    const distance = Math.hypot(dx, dy);
    if (distance > maxOffset) {
      const scale = maxOffset / distance;
      dx *= scale;
      dy *= scale;
    }

    knobEl.style.left = `calc(50% + ${dx}px)`;
    knobEl.style.top = `calc(50% + ${dy}px)`;
    value = {
      x: maxOffset ? dx / maxOffset : 0,
      y: maxOffset ? -dy / maxOffset : 0,
    };
    applyVelocity();
  }

  function resetKnob() {
    knobEl.style.left = '50%';
    knobEl.style.top = '50%';
    value = { x: 0, y: 0 };
    active = false;
    pointerId = null;
    joystickEl.classList.remove('is-active');
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
    if (active) return;
    active = true;
    pointerId = event.pointerId;
    joystickEl.classList.add('is-active');
    updateMaxOffset();
    baseEl.setPointerCapture(event.pointerId);
    const { dx, dy } = pointerPosition(event);
    setKnobOffset(dx, dy);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!active || event.pointerId !== pointerId) return;
    const { dx, dy } = pointerPosition(event);
    setKnobOffset(dx, dy);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!active || event.pointerId !== pointerId) return;
    if (baseEl.hasPointerCapture(event.pointerId)) {
      baseEl.releasePointerCapture(event.pointerId);
    }
    resetKnob();
    event.preventDefault();
  }

  function startRobotControl(ros) {
    if (cmdVelTopic) return;

    cmdVelTopic = new ROSLIB.Topic({
      ros,
      name: CMD_VEL_TOPIC,
      messageType: 'geometry_msgs/msg/Twist',
    });
  }

  baseEl.addEventListener('pointerdown', onPointerDown);
  baseEl.addEventListener('pointermove', onPointerMove);
  baseEl.addEventListener('pointerup', onPointerUp);
  baseEl.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', updateMaxOffset);
  const resizeObserver = new ResizeObserver(updateMaxOffset);
  resizeObserver.observe(baseEl);
  updateMaxOffset();

  window.unitreeRobotControl = { start: startRobotControl };
})();
