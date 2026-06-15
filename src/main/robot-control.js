(function () {
  const CMD_VEL_TOPIC = '/cmd_vel';
  const CMD_CTL_SDK_TOPIC = '/cmd_ctl_sdk';
  const ROBOT_MODE_TOPIC = '/robot_mode';
  const ROBOT_MODE_QUERY_TOPIC = '/robot_mode_query';
  const CMD_SDK = {
    DAMP: 1000,
    BALANCE_STAND: 1001,
    STAND_DOWN: 1002,
    LOCK_JOINTS: 1003,
    UNLOCK_JOINTS: 1004,
    AI_MODE: 1005,
    SPORT_MODE: 1006,
    SPEED_FAST: 1007,
    SPEED_SLOW: 1008,
  };
  const FAST_LEVEL_MULTIPLIER = 1.4;
  const AI_SPEED_LIMITS = {
    linearX: 0.6 * FAST_LEVEL_MULTIPLIER,
    linearY: 0.4 * FAST_LEVEL_MULTIPLIER,
    angularZ: 0.8 * FAST_LEVEL_MULTIPLIER,
  };
  const SPORT_LINEAR_MAGNITUDE = 1.2 * FAST_LEVEL_MULTIPLIER;
  const PUBLISH_HZ = 20;
  const KEYBOARD_RAMP_SEC = 0.22;
  const KEYBOARD_INPUT_EPSILON = 0.01;

  const joystickEl = document.getElementById('move-joystick');
  const baseEl = joystickEl?.querySelector('.joystick-base');
  const knobEl = joystickEl?.querySelector('.joystick-knob');
  const modeToggleBtn = document.getElementById('robot-mode-toggle');
  const robotControlsPanel = document.getElementById('robot-controls');
  const commandButtons = document.querySelectorAll('.main-view .robot-cmd-btn:not(.robot-mode-toggle)');

  let joystickActive = false;
  let pointerId = null;
  let maxOffset = 0;
  let joystickValue = { x: 0, y: 0 };
  let cmdVelTopic = null;
  let cmdCtlTopic = null;
  let robotModeTopic = null;
  let robotModeQueryTopic = null;
  let robotMode = null;
  let modeChanging = false;
  let pendingModeKind = null;
  let modeChangeQueryTimer = null;
  let modeChangeTimeoutTimer = null;
  let modeChangePollTimer = null;
  let publishTimer = null;
  const MODE_CHANGE_TIMEOUT_MS = 20000;
  const MODE_CHANGE_POLL_MS = 1000;
  const pressedKeys = new Set();
  let keyboardSmoothed = { forward: 0, yaw: 0, lateral: 0 };

  const stopTwist = {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };

  function clamp(value) {
    return Math.max(-1, Math.min(1, value));
  }

  function isControlsPanelEnabled() {
    return robotControlsPanel && !robotControlsPanel.classList.contains('is-hidden');
  }

  function resetMovementInput() {
    pressedKeys.clear();
    keyboardSmoothed = { forward: 0, yaw: 0, lateral: 0 };
    joystickActive = false;
    pointerId = null;
    joystickValue = { x: 0, y: 0 };
    joystickEl?.classList.remove('is-active');
    publishCmdVel(stopTwist);
    stopPublishing();
    syncKnobVisual();
  }

  function setControlsEnabled(enabled) {
    if (enabled) return;
    resetMovementInput();
  }

  function getKeyboardTargetInput() {
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

  function moveToward(current, target, maxDelta) {
    if (current === target) return current;
    const delta = target - current;
    if (Math.abs(delta) <= maxDelta) return target;
    return current + Math.sign(delta) * maxDelta;
  }

  function updateKeyboardRamp() {
    const target = getKeyboardTargetInput();
    const step = (1 / PUBLISH_HZ) / KEYBOARD_RAMP_SEC;

    keyboardSmoothed.forward = moveToward(keyboardSmoothed.forward, target.forward, step);
    keyboardSmoothed.yaw = moveToward(keyboardSmoothed.yaw, target.yaw, step);
    keyboardSmoothed.lateral = moveToward(keyboardSmoothed.lateral, target.lateral, step);
  }

  function getKeyboardInput() {
    return keyboardSmoothed;
  }

  function isKeyboardInputActive() {
    const { forward, yaw, lateral } = keyboardSmoothed;
    return Math.abs(forward) > KEYBOARD_INPUT_EPSILON
      || Math.abs(yaw) > KEYBOARD_INPUT_EPSILON
      || Math.abs(lateral) > KEYBOARD_INPUT_EPSILON;
  }

  function getSpeedLimits() {
    if (robotMode === 'sport') {
      return { kind: 'sport', linearMagnitude: SPORT_LINEAR_MAGNITUDE, angularZ: AI_SPEED_LIMITS.angularZ };
    }

    return { kind: 'ai', ...AI_SPEED_LIMITS };
  }

  function scaleSportLinear(forward, lateral, maxMagnitude) {
    let linearX = forward * maxMagnitude;
    let linearY = lateral * maxMagnitude;
    const magnitude = Math.hypot(linearX, linearY);

    if (magnitude > maxMagnitude) {
      const scale = maxMagnitude / magnitude;
      linearX *= scale;
      linearY *= scale;
    }

    return { x: linearX, y: linearY };
  }

  function buildTwist() {
    if (!isControlsPanelEnabled()) {
      return stopTwist;
    }

    updateKeyboardRamp();
    const keyboard = getKeyboardInput();
    const joyX = joystickActive ? joystickValue.x : 0;
    const joyY = joystickActive ? joystickValue.y : 0;

    const forward = clamp(joyY + keyboard.forward);
    const yaw = clamp(-joyX + keyboard.yaw);
    const lateral = clamp(keyboard.lateral);

    if (!forward && !yaw && !lateral) {
      return stopTwist;
    }

    const limits = getSpeedLimits();

    if (limits.kind === 'sport') {
      const linear = scaleSportLinear(forward, lateral, limits.linearMagnitude);
      return {
        linear: { x: linear.x, y: linear.y, z: 0 },
        angular: { x: 0, y: 0, z: yaw * limits.angularZ },
      };
    }

    return {
      linear: {
        x: forward * limits.linearX,
        y: lateral * limits.linearY,
        z: 0,
      },
      angular: { x: 0, y: 0, z: yaw * limits.angularZ },
    };
  }

  function isControlActive() {
    if (!isControlsPanelEnabled()) return false;
    return joystickActive || pressedKeys.size > 0;
  }

  function stopKeyboardControl() {
    keyboardSmoothed = { forward: 0, yaw: 0, lateral: 0 };
    stopPublishing();
    publishCmdVel(stopTwist);
    syncKnobVisual();
  }

  function publishCmdVel(twist) {
    if (!cmdVelTopic) return;
    cmdVelTopic.publish(twist);
  }

  function publishCmdCtl(data) {
    if (!cmdCtlTopic) return;
    cmdCtlTopic.publish({ data });
  }

  function parseRobotModeCode(code) {
    if (code === CMD_SDK.AI_MODE) {
      return { kind: 'ai', label: 'AI' };
    }
    if (code === CMD_SDK.SPORT_MODE) {
      return { kind: 'sport', label: 'Sport' };
    }
    if (code === 0) {
      return { kind: 'none', label: 'Mode' };
    }
    if (code < 0) {
      return { kind: 'error', label: 'Mode error' };
    }
    return { kind: 'unknown', label: 'Unknown' };
  }

  function setModeToggleDisabled(disabled) {
    if (!modeToggleBtn) return;
    modeToggleBtn.disabled = disabled;
    modeToggleBtn.classList.toggle('is-changing', disabled);
  }

  function clearModeChangeTimers() {
    if (modeChangeQueryTimer) {
      window.clearTimeout(modeChangeQueryTimer);
      modeChangeQueryTimer = null;
    }
    if (modeChangePollTimer) {
      window.clearInterval(modeChangePollTimer);
      modeChangePollTimer = null;
    }
    if (modeChangeTimeoutTimer) {
      window.clearTimeout(modeChangeTimeoutTimer);
      modeChangeTimeoutTimer = null;
    }
  }

  function applyDefaultSpeedLevel() {
    publishCmdCtl(CMD_SDK.SPEED_SLOW);
  }

  function finishModeChange(parsed, failed = false) {
    modeChanging = false;
    pendingModeKind = null;
    clearModeChangeTimers();
    robotMode = parsed.kind;
    setModeToggleDisabled(false);
    updateModeToggleUi();

    if (failed || parsed.kind === 'error') {
      window.unitreeAppToast?.show?.('Failed to change motion mode.', 'is-error');
      return;
    }

    applyDefaultSpeedLevel();
    window.unitreeAppToast?.show?.(`Motion mode: ${parsed.label}`, 'is-success');
  }

  function getMotionModeStatusLabel() {
    if (modeChanging) {
      return pendingModeKind === 'ai' ? 'AI…' : pendingModeKind === 'sport' ? 'Sport…' : 'Mode…';
    }
    if (robotMode === 'ai') return 'AI';
    if (robotMode === 'sport') return 'Sport';
    if (robotMode === 'error') return 'Error';
    return null;
  }

  function updateMotionModeStatus() {
    const statusEl = document.getElementById('world-status');
    if (!statusEl) return;
    window.unitreeSensorStatus?.setMotionModeDisplay?.(statusEl, getMotionModeStatusLabel());
  }

  function updateModeToggleUi() {
    if (!modeToggleBtn) {
      updateMotionModeStatus();
      return;
    }

    modeToggleBtn.classList.remove('is-ai-mode', 'is-sport-mode', 'is-mode-unknown', 'is-mode-error');

    if (modeChanging) {
      const label = pendingModeKind === 'ai' ? 'AI…' : pendingModeKind === 'sport' ? 'Sport…' : 'Mode…';
      modeToggleBtn.classList.add('is-mode-unknown');
      modeToggleBtn.textContent = label;
      modeToggleBtn.setAttribute('aria-pressed', 'false');
      modeToggleBtn.setAttribute('aria-label', 'Changing motion mode…');
    } else if (robotMode === 'ai') {
      modeToggleBtn.classList.add('is-ai-mode');
      modeToggleBtn.textContent = 'AI';
      modeToggleBtn.setAttribute('aria-pressed', 'true');
      modeToggleBtn.setAttribute('aria-label', 'AI mode (click to switch to Sport)');
    } else if (robotMode === 'sport') {
      modeToggleBtn.classList.add('is-sport-mode');
      modeToggleBtn.textContent = 'Sport';
      modeToggleBtn.setAttribute('aria-pressed', 'true');
      modeToggleBtn.setAttribute('aria-label', 'Sport mode (click to switch to AI)');
    } else if (robotMode === 'error') {
      modeToggleBtn.classList.add('is-mode-error');
      modeToggleBtn.textContent = 'Mode error';
      modeToggleBtn.setAttribute('aria-pressed', 'false');
      modeToggleBtn.setAttribute('aria-label', 'Motion mode error (click to retry AI mode)');
    } else {
      modeToggleBtn.classList.add('is-mode-unknown');
      modeToggleBtn.textContent = 'Mode';
      modeToggleBtn.setAttribute('aria-pressed', 'false');
      modeToggleBtn.setAttribute('aria-label', 'Motion mode (click to set AI mode)');
    }

    updateMotionModeStatus();
  }

  function onRobotModeMessage(message) {
    const parsed = parseRobotModeCode(message?.data ?? 0);

    if (modeChanging) {
      if (parsed.kind === pendingModeKind) {
        finishModeChange(parsed);
        return;
      }
      if (parsed.kind === 'error') {
        finishModeChange(parsed, true);
      }
      return;
    }

    robotMode = parsed.kind;
    updateModeToggleUi();
    if (isControlActive()) {
      applyVelocity();
    }
  }

  function queryRobotMode() {
    if (!robotModeQueryTopic) return;
    robotModeQueryTopic.publish({ data: 0 });
  }

  function refreshRobotMode(delays = [500, 1500, 3000]) {
    delays.forEach((delay) => {
      window.setTimeout(queryRobotMode, delay);
    });
  }

  function onModeToggleClick() {
    if (modeChanging || modeToggleBtn?.disabled) return;

    const nextKind = robotMode === 'ai' ? 'sport' : 'ai';
    const nextCode = nextKind === 'ai' ? CMD_SDK.AI_MODE : CMD_SDK.SPORT_MODE;

    modeChanging = true;
    pendingModeKind = nextKind;
    setModeToggleDisabled(true);
    updateModeToggleUi();

    publishCmdCtl(nextCode);
    window.unitreeAppToast?.show?.(
      `Changing to ${nextKind === 'ai' ? 'AI' : 'Sport'}…`,
      'is-success',
    );

    clearModeChangeTimers();
    modeChangeQueryTimer = window.setTimeout(queryRobotMode, 500);
    modeChangePollTimer = window.setInterval(queryRobotMode, MODE_CHANGE_POLL_MS);
    modeChangeTimeoutTimer = window.setTimeout(() => {
      if (!modeChanging) return;
      modeChanging = false;
      pendingModeKind = null;
      clearModeChangeTimers();
      setModeToggleDisabled(false);
      queryRobotMode();
      updateModeToggleUi();
      window.unitreeAppToast?.show?.('Motion mode change timed out.', 'is-error');
    }, MODE_CHANGE_TIMEOUT_MS);
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
      if (!isControlActive()) {
        stopPublishing();
        return;
      }

      publishCmdVel(buildTwist());
      syncKnobVisual();
    }, 1000 / PUBLISH_HZ);
  }

  function applyVelocity() {
    if (!isControlActive()) {
      stopPublishing();
      publishCmdVel(stopTwist);
      syncKnobVisual();
      return;
    }

    publishCmdVel(buildTwist());
    syncKnobVisual();
    startPublishing();
  }

  function updateMaxOffset() {
    if (!baseEl || !knobEl) return;
    const baseSize = baseEl.clientWidth;
    const knobSize = knobEl.clientWidth;
    maxOffset = Math.max(8, (baseSize - knobSize) / 2);
  }

  function syncKnobVisual() {
    if (!knobEl) return;

    updateMaxOffset();

    let x = 0;
    let y = 0;
    let active = false;

    if (joystickActive) {
      x = joystickValue.x;
      y = joystickValue.y;
      active = true;
    } else {
      const keyboard = getKeyboardInput();
      x = clamp(-keyboard.yaw);
      y = clamp(keyboard.forward);
      active = isKeyboardInputActive() || pressedKeys.size > 0;
    }

    const dx = x * maxOffset;
    const dy = -y * maxOffset;
    knobEl.style.left = `calc(50% + ${dx}px)`;
    knobEl.style.top = `calc(50% + ${dy}px)`;
    joystickEl?.classList.toggle('is-active', active);
  }

  function setKnobOffset(dx, dy) {
    if (!knobEl) return;

    const distance = Math.hypot(dx, dy);
    if (distance > maxOffset) {
      const scale = maxOffset / distance;
      dx *= scale;
      dy *= scale;
    }

    joystickValue = {
      x: maxOffset ? dx / maxOffset : 0,
      y: maxOffset ? -dy / maxOffset : 0,
    };
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
    if (!isControlsPanelEnabled() || !baseEl || joystickActive) return;
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
    joystickActive = false;
    pointerId = null;
    joystickValue = { x: 0, y: 0 };
    applyVelocity();
    event.preventDefault();
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function onKeyDown(event) {
    if (!isControlsPanelEnabled() || isTypingTarget(event.target)) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;

    if (!pressedKeys.has(event.code)) {
      pressedKeys.add(event.code);
      applyVelocity();
    }
    event.preventDefault();
  }

  function onKeyUp(event) {
    if (!isControlsPanelEnabled()) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;

    if (pressedKeys.delete(event.code)) {
      if (!joystickActive && pressedKeys.size === 0) {
        stopKeyboardControl();
      } else {
        applyVelocity();
      }
    }
    event.preventDefault();
  }

  function clearKeyboard() {
    if (!pressedKeys.size) return;
    pressedKeys.clear();
    if (!joystickActive) {
      stopKeyboardControl();
    } else {
      applyVelocity();
    }
  }

  const COMMAND_TOASTS = {
    select: 'Joints locked',
    start: 'Joints unlocked',
    'stand-up': 'Stand up',
    'stand-down': 'Stand down',
    'speed-fast': 'Speed: Fast',
    'speed-normal': 'Speed: Normal',
  };

  function showCommandToast(cmd) {
    const message = COMMAND_TOASTS[cmd];
    if (!message) return;
    window.unitreeAppToast?.show?.(message, 'is-success');
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
      publishCmdCtl(CMD_SDK.LOCK_JOINTS);
    } else if (cmd === 'start') {
      publishCmdCtl(CMD_SDK.UNLOCK_JOINTS);
    } else if (cmd === 'stand-up') {
      publishCmdCtl(CMD_SDK.BALANCE_STAND);
    } else if (cmd === 'stand-down') {
      publishCmdCtl(CMD_SDK.STAND_DOWN);
    } else if (cmd === 'speed-fast') {
      publishCmdCtl(CMD_SDK.SPEED_FAST);
    } else if (cmd === 'speed-normal') {
      applyDefaultSpeedLevel();
    }

    showCommandToast(cmd);
    flashButton(button);
  }

  function ensureCmdCtlTopic(ros) {
    if (!cmdCtlTopic) {
      cmdCtlTopic = new ROSLIB.Topic({
        ros,
        name: CMD_CTL_SDK_TOPIC,
        messageType: 'std_msgs/msg/Int32',
      });
    }
  }

  function ensureModeTopics(ros) {
    if (!robotModeTopic) {
      robotModeTopic = new ROSLIB.Topic({
        ros,
        name: ROBOT_MODE_TOPIC,
        messageType: 'std_msgs/msg/Int32',
      });
      robotModeTopic.subscribe(onRobotModeMessage);
    }

    if (!robotModeQueryTopic) {
      robotModeQueryTopic = new ROSLIB.Topic({
        ros,
        name: ROBOT_MODE_QUERY_TOPIC,
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
    ensureModeTopics(ros);
    updateModeToggleUi();
    queryRobotMode();
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

  modeToggleBtn?.addEventListener('click', onModeToggleClick);
  updateModeToggleUi();

  window.unitreeRobotControl = {
    start: startRobotControl,
    refreshRobotMode,
    setControlsEnabled,
  };
})();
