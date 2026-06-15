(function () {
  const RESET_TOPIC = '/reset';
  const RESET_TYPE = 'geometry_msgs/msg/Pose';
  const STORAGE_KEY = 'unitree-b2-reset-positions';
  const RESET_HEIGHT_OFFSET_M = 1;

  const dialog = document.getElementById('reset-dialog');
  const listEl = document.getElementById('reset-position-list');
  const nameInput = document.getElementById('reset-position-name');
  const messageEl = document.getElementById('reset-dialog-message');
  const saveBtn = document.getElementById('reset-save-position');
  const deleteBtn = document.getElementById('reset-delete-position');
  const resetBtn = document.getElementById('reset-confirm');
  const cancelBtn = document.getElementById('reset-cancel');
  const closeBtn = document.getElementById('reset-dialog-close');

  if (!dialog || !listEl) return;

  let resetTopic = null;
  let selectedId = null;
  let savedPositions = loadPositions();

  function loadPositions() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter((entry) => entry?.id && entry?.pose?.position && entry?.pose?.orientation);
    } catch {
      return [];
    }
  }

  function persistPositions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPositions));
  }

  function clonePose(pose) {
    return {
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
  }

  function poseForReset(pose) {
    const resetPose = clonePose(pose);
    resetPose.position.z += RESET_HEIGHT_OFFSET_M;
    return resetPose;
  }

  function formatPose(pose) {
    const { x, y, z } = pose.position;
    return `x:${x.toFixed(2)} y:${y.toFixed(2)} z:${z.toFixed(2)}`;
  }

  function setMessage(text, type) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.remove('is-error', 'is-success');
    if (type) messageEl.classList.add(type);
  }

  function clearMessage() {
    setMessage('', null);
  }

  function showToast(message, type = 'is-success') {
    window.unitreeAppToast?.show?.(message, type);
  }

  function getResetLabel(activeSelectedId) {
    if (activeSelectedId) {
      return savedPositions.find((item) => item.id === activeSelectedId)?.name ?? 'saved position';
    }
    return 'current position';
  }

  function getCurrentPose() {
    return window.unitreeWorld?.getCurrentRosPose?.() ?? null;
  }

  function ensureResetTopic(ros) {
    if (!resetTopic) {
      resetTopic = new ROSLIB.Topic({
        ros,
        name: RESET_TOPIC,
        messageType: RESET_TYPE,
      });
    }
  }

  function publishResetPose(pose) {
    return window.unitreeRos.getConnection().then((ros) => {
      ensureResetTopic(ros);
      resetTopic.publish(poseForReset(pose));
    });
  }

  function renderPositionList() {
    listEl.innerHTML = '';

    if (!savedPositions.length) {
      const empty = document.createElement('p');
      empty.className = 'reset-position-empty';
      empty.textContent = 'No saved positions yet.';
      listEl.appendChild(empty);
      deleteBtn.disabled = true;
      return;
    }

    savedPositions.forEach((entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'reset-position-item';
      item.dataset.id = entry.id;
      if (entry.id === selectedId) {
        item.classList.add('is-selected');
      }

      const name = document.createElement('span');
      name.className = 'reset-position-item-name';
      name.textContent = entry.name;

      const coords = document.createElement('span');
      coords.className = 'reset-position-item-coords';
      coords.textContent = formatPose(entry.pose);

      item.append(name, coords);
      item.addEventListener('click', () => {
        selectedId = entry.id;
        renderPositionList();
        clearMessage();
      });
      listEl.appendChild(item);
    });

    deleteBtn.disabled = !selectedId;
  }

  function openDialog() {
    selectedId = null;
    if (nameInput) nameInput.value = '';
    clearMessage();
    renderPositionList();
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    nameInput?.focus();
  }

  function closeDialog() {
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
    clearMessage();
  }

  function saveCurrentPosition() {
    const pose = getCurrentPose();
    if (!pose) {
      setMessage('Current robot pose is not available yet.', 'is-error');
      return;
    }

    const name = nameInput?.value.trim() || `Position ${savedPositions.length + 1}`;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      pose: clonePose(pose),
      savedAt: new Date().toISOString(),
    };

    savedPositions.unshift(entry);
    persistPositions();
    selectedId = entry.id;
    if (nameInput) nameInput.value = '';
    renderPositionList();
    setMessage(`Saved "${entry.name}".`, 'is-success');
  }

  function deleteSelectedPosition() {
    if (!selectedId) return;
    const index = savedPositions.findIndex((entry) => entry.id === selectedId);
    if (index === -1) return;

    const [removed] = savedPositions.splice(index, 1);
    persistPositions();
    selectedId = null;
    renderPositionList();
    setMessage(`Deleted "${removed.name}".`, 'is-success');
  }

  function resetSimulation() {
    let pose = null;
    const activeSelectedId = selectedId;

    if (activeSelectedId) {
      const entry = savedPositions.find((item) => item.id === activeSelectedId);
      if (entry) {
        pose = entry.pose;
      }
    }

    if (!pose) {
      pose = getCurrentPose();
      if (!pose) {
        setMessage('Current robot pose is not available yet.', 'is-error');
        return;
      }
    }

    const label = getResetLabel(activeSelectedId);
    closeDialog();

    publishResetPose(pose)
      .then(() => {
        showToast(`Simulation reset at ${label}.`, 'is-success');
        window.unitreeRobotControl?.refreshRobotMode?.();
      })
      .catch((error) => {
        showToast(error?.message || 'Failed to publish reset.', 'is-error');
      });
  }

  saveBtn?.addEventListener('click', saveCurrentPosition);
  deleteBtn?.addEventListener('click', deleteSelectedPosition);
  resetBtn?.addEventListener('click', resetSimulation);
  cancelBtn?.addEventListener('click', closeDialog);
  closeBtn?.addEventListener('click', closeDialog);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });

  nameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveCurrentPosition();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (dialog.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  });

  window.unitreeResetSimulation = {
    openDialog,
    closeDialog,
  };
})();
