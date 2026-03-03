function setVar(el, prop, val) {
  return el.style.setProperty('--' + prop, val);
}

const NET_SIDES = ['front', 'back'];
const CANVAS_SIZE = 1765;

const viewport = document.querySelector('#viewport');
const scene = document.querySelector('#scene');
const layerSelect = document.querySelector('#layer');
const legendList = document.querySelector('#legend-list');
const legendEmpty = document.querySelector('#legend-empty');

const layers = {};
const netState = {
  selectedNetId: null,
  hoverNetId: null,
  loaded: false,
  hiddenBySide: {
    front: new Set(),
    back: new Set(),
  },
  sides: {
    front: null,
    back: null,
  },
};

const interactionState = {
  pendingNetSelectTimer: null,
};

const viewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  flip: false,
  isSpaceDown: false,
  panning: null,
};

function editableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function updateSceneTransform() {
  if (viewState.flip) {
    const shiftX = viewState.panX + viewState.zoom * CANVAS_SIZE;
    scene.style.transform = `translate(${shiftX}px, ${viewState.panY}px) scale(${-viewState.zoom}, ${viewState.zoom})`;
    return;
  }
  scene.style.transform = `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom}, ${viewState.zoom})`;
}

function resetView() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const fit = Math.min(rect.width / CANVAS_SIZE, rect.height / CANVAS_SIZE);
  viewState.zoom = Math.max(0.05, fit);
  viewState.panX = (rect.width - CANVAS_SIZE * viewState.zoom) / 2;
  viewState.panY = (rect.height - CANVAS_SIZE * viewState.zoom) / 2;
  updateSceneTransform();
}

function zoomAt(clientX, clientY, nextZoom) {
  const rect = viewport.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;

  let worldX = (px - viewState.panX) / viewState.zoom;
  if (viewState.flip) {
    worldX = CANVAS_SIZE - worldX;
  }
  const worldY = (py - viewState.panY) / viewState.zoom;

  viewState.zoom = Math.min(40, Math.max(0.05, nextZoom));
  if (viewState.flip) {
    viewState.panX = px - viewState.zoom * (CANVAS_SIZE - worldX);
  } else {
    viewState.panX = px - worldX * viewState.zoom;
  }
  viewState.panY = py - worldY * viewState.zoom;
  updateSceneTransform();
}

function toggleFlip() {
  viewState.flip = !viewState.flip;
  updateSceneTransform();
}

function setNetOverlayVisible(svg, visible) {
  if (!svg) return;
  svg.style.display = visible ? 'block' : 'none';
}

document.querySelector('#opacity').oninput = (e) => {
  setVar(document.documentElement, 'opacity', e.target.value / 100);
};

document.querySelector('#flip').onclick = () => {
  toggleFlip();
};

document.querySelector('#reset-view').onclick = () => {
  resetView();
};

let visible = null;

function currentSide() {
  return visible < 3 ? 'front' : 'back';
}

function moveTo(i) {
  if (i < 0 || i >= pm.length) return;
  cancelPendingNetSelection();
  layerSelect.value = i;
  pm[visible].hidden = true;
  visible = i;
  pm[visible].hidden = false;
  updateAllLayers();
}

function pairedLayerIndex(i) {
  if (!Number.isInteger(i)) return null;
  if (!pm.length) return null;
  const target = pm.length - 1 - i;
  if (target < 0 || target >= pm.length) return null;
  return target;
}

function handleKey(key) {
  if (key === 'w' || key === 'arrowup') moveTo(visible - 1);
  if (key === 's' || key === 'arrowdown') moveTo(visible + 1);
  if (key === 'f' || key === 'arrowleft' || key === 'arrowright') {
    toggleFlip();
  }
}

document.documentElement.addEventListener('keydown', (e) => {
  if (editableTarget(e.target)) return;
  const key = e.key.toLowerCase();

  if (key === ' ') {
    viewState.isSpaceDown = true;
    return;
  }

  if ((key === '+' || key === '=') && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, viewState.zoom * 1.15);
    return;
  }

  if (key === '-' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, viewState.zoom / 1.15);
  }
});

document.documentElement.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    viewState.isSpaceDown = false;
    return;
  }
  if (editableTarget(e.target)) return;
  handleKey(e.key.toLowerCase());
});

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const scaleStep = Math.exp(-e.deltaY * 0.0016);
    zoomAt(e.clientX, e.clientY, viewState.zoom * scaleStep);
  },
  { passive: false }
);

viewport.addEventListener('pointerdown', (e) => {
  const shouldPan = viewState.isSpaceDown || e.button === 1;
  if (!shouldPan) return;
  e.preventDefault();

  viewState.panning = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: viewState.panX,
    originY: viewState.panY,
  };
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener('pointermove', (e) => {
  if (!viewState.panning || viewState.panning.pointerId !== e.pointerId) return;
  const dx = e.clientX - viewState.panning.startX;
  const dy = e.clientY - viewState.panning.startY;
  viewState.panX = viewState.panning.originX + dx;
  viewState.panY = viewState.panning.originY + dy;
  updateSceneTransform();
});

viewport.addEventListener('pointerup', (e) => {
  if (!viewState.panning || viewState.panning.pointerId !== e.pointerId) return;
  viewState.panning = null;
  viewport.releasePointerCapture(e.pointerId);
});

viewport.addEventListener('pointercancel', (e) => {
  if (!viewState.panning || viewState.panning.pointerId !== e.pointerId) return;
  viewState.panning = null;
  viewport.releasePointerCapture(e.pointerId);
});

viewport.addEventListener('dblclick', (e) => {
  if (viewState.panning) return;
  if (editableTarget(e.target)) return;
  cancelPendingNetSelection();
  const target = pairedLayerIndex(visible);
  if (!Number.isInteger(target) || target === visible) return;
  e.preventDefault();
  moveTo(target);
});

function updateAllLayers() {
  for (const l in layers) {
    layers[l].update();
  }
  updateLegend();
}

function setPathInteractionClass(kind, netId) {
  if (!netId) return;
  for (const side of NET_SIDES) {
    const svg = netState.sides[side];
    if (!svg) continue;
    svg
      .querySelectorAll(`.net-path[data-net-id="${CSS.escape(netId)}"]`)
      .forEach((node) => {
        node.classList.toggle('is-hover', kind === 'hover');
        node.classList.toggle('is-selected', kind === 'selected');
      });
  }
}

function clearInteractionClass(kind, netId) {
  if (!netId) return;
  const className = kind === 'hover' ? 'is-hover' : 'is-selected';
  for (const side of NET_SIDES) {
    const svg = netState.sides[side];
    if (!svg) continue;
    svg
      .querySelectorAll(`.net-path[data-net-id="${CSS.escape(netId)}"]`)
      .forEach((node) => node.classList.remove(className));
  }
}

function isNetVisible(side, netId) {
  if (!netId) return true;
  const hidden = netState.hiddenBySide[side];
  if (!hidden) return true;
  return !hidden.has(netId);
}

function applyNetVisibilityForSide(side, netId = null) {
  const svg = netState.sides[side];
  if (!svg) return;

  if (netId) {
    const visible = isNetVisible(side, netId);
    svg.querySelectorAll(`[data-net-id="${CSS.escape(netId)}"]`).forEach((node) => {
      node.style.display = visible ? '' : 'none';
    });
    return;
  }

  const visited = new Set();
  svg.querySelectorAll('[data-net-id]').forEach((node) => {
    const id = node.dataset.netId;
    if (!id || visited.has(id)) return;
    visited.add(id);
    applyNetVisibilityForSide(side, id);
  });
}

function setNetVisibility(side, netId, visible) {
  if (!netId) return;
  const hidden = netState.hiddenBySide[side];
  if (!hidden) return;

  if (visible) {
    hidden.delete(netId);
  } else {
    hidden.add(netId);
  }

  applyNetVisibilityForSide(side, netId);

  if (!visible && netState.selectedNetId === netId) {
    clearInteractionClass('selected', netState.selectedNetId);
    netState.selectedNetId = null;
  }
  if (!visible && netState.hoverNetId === netId) {
    clearInteractionClass('hover', netState.hoverNetId);
    netState.hoverNetId = null;
  }

  updateLegend();
}

function selectNet(netId) {
  if (netState.selectedNetId === netId) {
    clearInteractionClass('selected', netState.selectedNetId);
    netState.selectedNetId = null;
    updateLegend();
    return;
  }

  clearInteractionClass('selected', netState.selectedNetId);
  netState.selectedNetId = netId;
  setPathInteractionClass('selected', netId);
  updateLegend();
}

function cancelPendingNetSelection() {
  if (interactionState.pendingNetSelectTimer === null) return;
  clearTimeout(interactionState.pendingNetSelectTimer);
  interactionState.pendingNetSelectTimer = null;
}

function queueNetSelection(netId) {
  cancelPendingNetSelection();
  interactionState.pendingNetSelectTimer = setTimeout(() => {
    interactionState.pendingNetSelectTimer = null;
    selectNet(netId);
  }, 220);
}

function setHover(netId) {
  if (netState.hoverNetId === netId) return;
  clearInteractionClass('hover', netState.hoverNetId);
  netState.hoverNetId = netId;
  setPathInteractionClass('hover', netId);
}

function decorateNetPaths(svg) {
  const paths = svg.querySelectorAll('path[data-net-id]');

  paths.forEach((path) => {
    const color = path.dataset.color || path.getAttribute('stroke') || '#00d9ff';
    const strokeWidth = parseFloat(path.dataset.strokeWidth || path.getAttribute('stroke-width') || '1') || 1;

    path.classList.add('net-path');
    path.setAttribute('stroke', color);
    path.style.setProperty('--stroke-width', `${strokeWidth}`);
    path.setAttribute('stroke-width', `${strokeWidth}`);
    path.setAttribute('fill', color);
    path.setAttribute('fill-opacity', '1');

    const hit = path.cloneNode(false);
    hit.classList.remove('net-path');
    hit.classList.add('net-hit');
    hit.setAttribute('stroke-width', `${Math.max(6, strokeWidth * 8)}`);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('data-hit-target', '1');

    path.insertAdjacentElement('afterend', hit);
  });

  svg.addEventListener('pointerover', (event) => {
    const hit = event.target.closest('.net-hit[data-net-id]');
    if (!hit) return;
    setHover(hit.dataset.netId);
  });

  svg.addEventListener('pointerleave', () => {
    setHover(null);
  });

  svg.addEventListener('click', (event) => {
    const hit = event.target.closest('.net-hit[data-net-id]');
    if (!hit) return;
    if (event.detail > 1) return;
    queueNetSelection(hit.dataset.netId);
  });
}

async function loadNetOverlay(side) {
  const response = await fetch(`./pm/${side}-nets.svg`);
  if (!response.ok) {
    throw new Error(`Failed to load ${side} nets (${response.status})`);
  }

  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;

  setNetOverlayVisible(svg, false);
  svg.classList.add('layer');
  svg.setAttribute('viewBox', svg.getAttribute('viewBox') || '0 0 1765 1765');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  decorateNetPaths(svg);
  scene.append(svg);
  netState.sides[side] = svg;
  applyNetVisibilityForSide(side);
}

function addNetsLayer() {
  layers.nets = {
    enabled: true,
    update() {
      const showFront = currentSide() === 'front';
      const front = netState.sides.front;
      const back = netState.sides.back;
      setNetOverlayVisible(front, false);
      setNetOverlayVisible(back, false);

      if (!this.enabled) {
        updateLegend();
        return;
      }

      const active = showFront ? front : back;
      setNetOverlayVisible(active, true);
      updateLegend();
    },
  };
}

function gatherVisibleNets() {
  const side = currentSide();
  const svg = netState.sides[side];
  if (!svg || layers.nets?.enabled === false) return [];

  const nets = new Map();
  svg.querySelectorAll('.net-path[data-net-id]').forEach((path) => {
    const netId = path.dataset.netId;
    if (!netId || nets.has(netId)) return;

    nets.set(netId, {
      netId,
      label: path.dataset.netLabel || netId,
      category: path.dataset.category || 'uncategorized',
      color: path.dataset.color || path.getAttribute('stroke') || '#00d9ff',
      visible: isNetVisible(side, netId),
    });
  });

  return Array.from(nets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function updateLegend() {
  if (!netState.loaded) {
    legendEmpty.hidden = false;
    legendEmpty.textContent = 'Loading net paths...';
    legendList.innerHTML = '';
    return;
  }

  const rows = gatherVisibleNets();
  legendList.innerHTML = '';

  if (!rows.length) {
    legendEmpty.hidden = false;
    legendEmpty.textContent = 'No visible nets for this layer/side.';
    return;
  }

  legendEmpty.hidden = true;
  const side = currentSide();
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = row.netId === netState.selectedNetId ? 'is-selected' : '';
    if (!row.visible) li.classList.add('is-hidden');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'legend-toggle';
    toggle.checked = row.visible;
    toggle.title = row.visible ? 'Hide this net' : 'Show this net';
    toggle.addEventListener('click', (event) => event.stopPropagation());
    toggle.addEventListener('change', () => {
      setNetVisibility(side, row.netId, toggle.checked);
    });

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = row.color;

    const text = document.createElement('span');
    text.innerHTML = `<strong>${row.label}</strong><br><small>${row.category} · ${row.netId}</small>`;

    li.append(toggle, swatch, text);
    li.addEventListener('click', () => {
      if (!isNetVisible(side, row.netId)) return;
      selectNet(row.netId);
    });
    legendList.append(li);
  });
}

const pm = Array.from({ length: 6 }, (_, i) => {
  const img = new Image();
  img.src = `./pm/${i + 1}.jpg`;
  img.hidden = true;
  scene.append(img);
  visible = i;
  return img;
});

addNetsLayer();

layerSelect.oninput = (e) => {
  const value = parseInt(e.target.value, 10);
  moveTo(value);
};

pm[visible].hidden = false;
moveTo(5);
resetView();

Promise.allSettled(NET_SIDES.map((side) => loadNetOverlay(side))).then((results) => {
  netState.loaded = true;

  const failed = results.find((res) => res.status === 'rejected');
  if (failed) {
    legendEmpty.hidden = false;
    legendEmpty.textContent = 'Could not load one or more SVG net files.';
    console.error(failed.reason);
  }

  updateAllLayers();
});
