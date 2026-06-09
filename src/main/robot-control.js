(function () {
  const joystickEl = document.getElementById('move-joystick');
  if (!joystickEl) return;

  const baseEl = joystickEl.querySelector('.joystick-base');
  const knobEl = joystickEl.querySelector('.joystick-knob');
  if (!baseEl || !knobEl) return;

  let active = false;
  let pointerId = null;
  let maxOffset = 0;
  let value = { x: 0, y: 0 };

  function updateMaxOffset() {
    const baseSize = baseEl.clientWidth;
    const knobSize = knobEl.clientWidth;
    maxOffset = Math.max(8, (baseSize - knobSize) / 2);
  }

  function dispatchJoystick() {
    window.dispatchEvent(
      new CustomEvent('unitree:joystick', {
        detail: {
          x: value.x,
          y: value.y,
          active,
        },
      }),
    );
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
    dispatchJoystick();
  }

  function resetKnob() {
    knobEl.style.left = '50%';
    knobEl.style.top = '50%';
    value = { x: 0, y: 0 };
    active = false;
    pointerId = null;
    joystickEl.classList.remove('is-active');
    dispatchJoystick();
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

  baseEl.addEventListener('pointerdown', onPointerDown);
  baseEl.addEventListener('pointermove', onPointerMove);
  baseEl.addEventListener('pointerup', onPointerUp);
  baseEl.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', updateMaxOffset);
  const resizeObserver = new ResizeObserver(updateMaxOffset);
  resizeObserver.observe(baseEl);

  updateMaxOffset();
})();
