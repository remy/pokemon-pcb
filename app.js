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
const helpPanel = document.querySelector('#help');
const helpCloseButton = document.querySelector('#help-close');
const helpOpenButton = document.querySelector('#help-open');

const layers = {};
const netState = {
  selectedNetId: null,
  hoveredNetKey: null,
  legendHoverNetKey: null,
  pinnedPath: null,
  loaded: false,
  groups: [],
  groupDefaultsApplied: false,
  hiddenNetKeys: new Set(),
  sides: {
    front: null,
    back: null,
  },
};

const interactionState = {
  pendingNetSelectTimer: null,
  touchPoints: new Map(),
  pinch: null,
  suppressViewportClick: false,
  suppressViewportClickTimer: null,
};

const viewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  flip: true,
  isSpaceDown: false,
  panning: null,
};

function editableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function suppressViewportClickOnce() {
  interactionState.suppressViewportClick = true;
  if (interactionState.suppressViewportClickTimer) {
    clearTimeout(interactionState.suppressViewportClickTimer);
  }
  interactionState.suppressViewportClickTimer = setTimeout(() => {
    interactionState.suppressViewportClick = false;
    interactionState.suppressViewportClickTimer = null;
  }, 400);
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

function touchDistance(a, b) {
  const dx = b.clientX - a.clientX;
  const dy = b.clientY - a.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidpoint(a, b) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
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

if (helpCloseButton && helpPanel && helpOpenButton) {
  helpCloseButton.onclick = () => {
    helpPanel.hidden = true;
    helpOpenButton.hidden = false;
  };
  helpOpenButton.onclick = () => {
    helpPanel.hidden = false;
    helpOpenButton.hidden = true;
  };
}

let visible = null;

function currentSide() {
  return visible < 3 ? 'front' : 'back';
}

function moveTo(i) {
  if (i < 0 || i >= pm.length) return;
  cancelPendingNetSelection();
  clearPinnedPath();
  setHoveredNetKey(null);
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
  if (e.pointerType === 'touch') {
    interactionState.touchPoints.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    viewport.setPointerCapture(e.pointerId);

    if (interactionState.touchPoints.size === 1) {
      viewState.panning = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: viewState.panX,
        originY: viewState.panY,
        moved: false,
      };
      interactionState.pinch = null;
      return;
    }

    if (interactionState.touchPoints.size >= 2) {
      const points = Array.from(interactionState.touchPoints.values());
      const a = points[0];
      const b = points[1];
      const mid = touchMidpoint(a, b);
      interactionState.pinch = {
        startDistance: Math.max(1, touchDistance(a, b)),
        startZoom: viewState.zoom,
        lastMidX: mid.clientX,
        lastMidY: mid.clientY,
      };
      viewState.panning = null;
    }
    return;
  }

  const shouldPan = viewState.isSpaceDown || e.button === 1;
  if (!shouldPan) return;
  e.preventDefault();

  viewState.panning = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: viewState.panX,
    originY: viewState.panY,
    moved: false,
  };
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && interactionState.touchPoints.has(e.pointerId)) {
    interactionState.touchPoints.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
  }

  if (interactionState.pinch && interactionState.touchPoints.size >= 2) {
    const points = Array.from(interactionState.touchPoints.values());
    const a = points[0];
    const b = points[1];
    const distance = Math.max(1, touchDistance(a, b));
    const midpoint = touchMidpoint(a, b);
    const zoom = interactionState.pinch.startZoom * (distance / interactionState.pinch.startDistance);
    zoomAt(midpoint.clientX, midpoint.clientY, zoom);
    const deltaX = midpoint.clientX - interactionState.pinch.lastMidX;
    const deltaY = midpoint.clientY - interactionState.pinch.lastMidY;
    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      viewState.panX += deltaX;
      viewState.panY += deltaY;
      updateSceneTransform();
    }
    interactionState.pinch.lastMidX = midpoint.clientX;
    interactionState.pinch.lastMidY = midpoint.clientY;
    suppressViewportClickOnce();
    return;
  }

  if (!viewState.panning || viewState.panning.pointerId !== e.pointerId) return;
  const dx = e.clientX - viewState.panning.startX;
  const dy = e.clientY - viewState.panning.startY;
  viewState.panX = viewState.panning.originX + dx;
  viewState.panY = viewState.panning.originY + dy;
  if (!viewState.panning.moved && Math.sqrt(dx * dx + dy * dy) > 3) {
    viewState.panning.moved = true;
    suppressViewportClickOnce();
  }
  updateSceneTransform();
});

viewport.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') {
    interactionState.touchPoints.delete(e.pointerId);
    if (interactionState.pinch && interactionState.touchPoints.size < 2) {
      interactionState.pinch = null;
      if (interactionState.touchPoints.size === 1) {
        const [pointerId, point] = Array.from(interactionState.touchPoints.entries())[0];
        viewState.panning = {
          pointerId,
          startX: point.clientX,
          startY: point.clientY,
          originX: viewState.panX,
          originY: viewState.panY,
          moved: false,
        };
      } else {
        viewState.panning = null;
      }
    } else if (viewState.panning && viewState.panning.pointerId === e.pointerId) {
      viewState.panning = null;
    }
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
    return;
  }

  if (!viewState.panning || viewState.panning.pointerId !== e.pointerId) return;
  viewState.panning = null;
  viewport.releasePointerCapture(e.pointerId);
});

viewport.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') {
    interactionState.touchPoints.delete(e.pointerId);
    interactionState.pinch = null;
  }
  if (viewState.panning && viewState.panning.pointerId === e.pointerId) {
    viewState.panning = null;
  }
  try {
    viewport.releasePointerCapture(e.pointerId);
  } catch {
    // no-op
  }
});

viewport.addEventListener('click', (event) => {
  if (interactionState.suppressViewportClick) {
    interactionState.suppressViewportClick = false;
    if (interactionState.suppressViewportClickTimer) {
      clearTimeout(interactionState.suppressViewportClickTimer);
      interactionState.suppressViewportClickTimer = null;
    }
    return;
  }
  if (event.detail > 1) return;
  const path = event.target.closest('.net-path[data-net-id]');
  if (path) return;
  clearPinnedPath();
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

legendList.addEventListener('pointermove', (event) => {
  const row = event.target.closest('#legend-list li[data-net-key]');
  if (!row) {
    setLegendHoverNetKey(null);
    return;
  }
  setLegendHoverNetKey(row.dataset.netKey || null);
});

legendList.addEventListener('pointerleave', () => {
  setLegendHoverNetKey(null);
});

function updateAllLayers() {
  for (const l in layers) {
    layers[l].update();
  }
  updateLegend();
}

function visibilityKey(netId) {
  const raw = String(netId || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/^(front|back)-/, '');
}

function parseHexColor(value) {
  const raw = String(value || '').trim();
  const short = raw.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [, hex] = short;
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  const full = raw.match(/^#([0-9a-f]{6})$/i);
  if (full) {
    const [, hex] = full;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function linearizeChannel(channel) {
  const value = channel / 255;
  if (value <= 0.03928) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  if (!rgb) return 1;
  return (
    0.2126 * linearizeChannel(rgb.r) +
    0.7152 * linearizeChannel(rgb.g) +
    0.0722 * linearizeChannel(rgb.b)
  );
}

function mixWithWhite(rgb, amount) {
  const a = Math.min(1, Math.max(0, Number(amount) || 0));
  return {
    r: Math.round(rgb.r * (1 - a) + 255 * a),
    g: Math.round(rgb.g * (1 - a) + 255 * a),
    b: Math.round(rgb.b * (1 - a) + 255 * a),
  };
}

function rgbToHex(rgb) {
  const r = Math.min(255, Math.max(0, rgb.r));
  const g = Math.min(255, Math.max(0, rgb.g));
  const b = Math.min(255, Math.max(0, rgb.b));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function highlightStrokeColor(color) {
  const rgb = parseHexColor(color);
  if (!rgb) return '#ffffff';
  const luminance = relativeLuminance(rgb);
  const mixAmount = Math.min(0.9, Math.max(0.55, 0.55 + (1 - luminance) * 0.35));
  return rgbToHex(mixWithWhite(rgb, mixAmount));
}

function needsContrastRing(color) {
  const rgb = parseHexColor(color);
  if (!rgb) return false;
  return relativeLuminance(rgb) < 0.12;
}

function setHoveredNetKey(netId) {
  const key = visibilityKey(netId);
  const next = key.length ? key : null;
  if (netState.hoveredNetKey === next) return;
  netState.hoveredNetKey = next;
  updateLegendSelectionState();
}

function applyLegendHoverToPaths() {
  const key = netState.legendHoverNetKey;
  NET_SIDES.forEach((side) => {
    const svg = netState.sides[side];
    if (!svg) return;
    svg.querySelectorAll('.net-path[data-net-id]').forEach((path) => {
      const pathKey = visibilityKey(path.dataset.netId);
      const shouldHover = !!key && pathKey === key;
      path.classList.toggle('is-legend-hover', shouldHover);
    });
  });
}

function setLegendHoverNetKey(netId) {
  const key = visibilityKey(netId);
  const next = key.length ? key : null;
  if (netState.legendHoverNetKey === next) return;
  netState.legendHoverNetKey = next;
  applyLegendHoverToPaths();
}

function normalizeGroupNetIds(netIds) {
  const source = Array.isArray(netIds) ? netIds : [];
  const normalized = [];
  source.forEach((netId) => {
    const key = visibilityKey(netId);
    if (!key.length || normalized.includes(key)) return;
    normalized.push(key);
  });
  return normalized;
}

function normalizeViewerGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  const seen = new Set();
  const groups = [];
  rawGroups.forEach((raw, index) => {
    const name = String(raw?.name || '').trim() || `Group ${index + 1}`;
    let id = String(raw?.id || '').trim().toLowerCase();
    if (!id.length) id = `group-${name.toLowerCase().replace(/\s+/g, '-')}`;
    if (!id.length) id = `group-${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const orderRaw = parseInt(raw?.order, 10);
    const order = Number.isFinite(orderRaw) ? orderRaw : index;
    groups.push({
      id,
      name,
      order,
      defaultOn: raw?.defaultOn !== false,
      netIds: normalizeGroupNetIds(raw?.netIds),
    });
  });
  return groups;
}

function absorbViewerGroups(rawGroups) {
  const incoming = normalizeViewerGroups(rawGroups);
  if (!incoming.length) return;
  if (!netState.groups.length) {
    netState.groups = incoming;
    return;
  }

  const merged = netState.groups.map((group) => ({
    ...group,
    netIds: normalizeGroupNetIds(group.netIds),
  }));
  const byId = new Map(merged.map((group) => [group.id, group]));

  incoming.forEach((group) => {
    const current = byId.get(group.id);
    if (!current) {
      merged.push({ ...group, netIds: normalizeGroupNetIds(group.netIds) });
      return;
    }
    current.order = Math.min(current.order, group.order);
    current.defaultOn = current.defaultOn && group.defaultOn;
    current.netIds = normalizeGroupNetIds([...current.netIds, ...group.netIds]);
  });

  netState.groups = merged;
}

function applyGroupDefaultsOnce() {
  if (netState.groupDefaultsApplied) return;
  netState.groupDefaultsApplied = true;

  netState.groups.forEach((group) => {
    if (group.defaultOn !== false) return;
    normalizeGroupNetIds(group.netIds).forEach((key) => {
      netState.hiddenNetKeys.add(key);
    });
  });
}

function isNetVisible(side, netId) {
  if (!netId) return true;
  return !netState.hiddenNetKeys.has(visibilityKey(netId));
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
  const key = visibilityKey(netId);
  if (!key) return;

  if (visible) {
    netState.hiddenNetKeys.delete(key);
  } else {
    netState.hiddenNetKeys.add(key);
  }

  for (const s of NET_SIDES) {
    applyNetVisibilityForSide(s);
  }

  if (!visible && visibilityKey(netState.selectedNetId) === key) {
    netState.selectedNetId = null;
  }
  if (!visible && visibilityKey(netState.pinnedPath?.dataset?.netId) === key) {
    clearPinnedPath();
  }

  updateLegend();
}

function setSectionVisibility(rows, visible) {
  if (!Array.isArray(rows) || !rows.length) return;
  const affectedKeys = new Set();
  rows.forEach((row) => {
    const key = visibilityKey(row?.netId || row?.netKey || '');
    if (!key) return;
    affectedKeys.add(key);
    if (visible) {
      netState.hiddenNetKeys.delete(key);
    } else {
      netState.hiddenNetKeys.add(key);
    }
  });
  if (!affectedKeys.size) return;

  NET_SIDES.forEach((side) => applyNetVisibilityForSide(side));

  if (!visible) {
    if (affectedKeys.has(visibilityKey(netState.selectedNetId))) {
      netState.selectedNetId = null;
    }
    if (affectedKeys.has(visibilityKey(netState.pinnedPath?.dataset?.netId))) {
      clearPinnedPath();
    }
  }

  updateLegend();
}

function selectNet(netId) {
  if (netState.selectedNetId === netId) {
    netState.selectedNetId = null;
    updateLegendSelectionState();
    return;
  }

  netState.selectedNetId = netId;
  updateLegendSelectionState();
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

function syncPinnedHoverLock() {
  document.documentElement.classList.toggle('has-pinned-path', netState.pinnedPath instanceof SVGElement);
}

function clearPinnedPath() {
  if (netState.pinnedPath instanceof SVGElement) {
    netState.pinnedPath.classList.remove('is-pinned');
  }
  netState.pinnedPath = null;
  syncPinnedHoverLock();
}

function togglePinnedPath(path) {
  if (!(path instanceof SVGElement)) return;
  if (netState.pinnedPath === path) {
    clearPinnedPath();
    return;
  }
  clearPinnedPath();
  path.classList.add('is-pinned');
  netState.pinnedPath = path;
  syncPinnedHoverLock();
}

function decorateNetPaths(svg) {
  const paths = svg.querySelectorAll('path[data-net-id]');

  paths.forEach((path) => {
    const color = path.dataset.color || path.getAttribute('stroke') || '#00d9ff';
    const strokeWidth = parseFloat(path.dataset.strokeWidth || path.getAttribute('stroke-width') || '1') || 1;

    path.classList.add('net-path');
    path.classList.remove('is-pinned', 'has-contrast-ring', 'is-legend-hover');
    path.setAttribute('stroke', color);
    path.style.setProperty('--stroke-width', `${strokeWidth}px`);
    path.style.setProperty('--highlight-stroke', highlightStrokeColor(color));
    path.style.setProperty('--ring-color', 'rgba(237, 245, 255, 0.92)');
    if (needsContrastRing(color)) {
      path.classList.add('has-contrast-ring');
    }
    path.setAttribute('stroke-width', `${strokeWidth}`);
    path.setAttribute('fill', color);
    path.setAttribute('fill-opacity', '1');
  });

  svg.addEventListener('click', (event) => {
    const path = event.target.closest('.net-path[data-net-id]');
    if (!path) return;
    if (event.detail > 1) return;
    togglePinnedPath(path);
    queueNetSelection(path.dataset.netId);
  });

  svg.addEventListener('pointermove', (event) => {
    const path = event.target.closest('.net-path[data-net-id]');
    setHoveredNetKey(path?.dataset?.netId || null);
  });

  svg.addEventListener('pointerleave', () => {
    setHoveredNetKey(null);
  });

  applyLegendHoverToPaths();
}

async function loadNetOverlay(side) {
  const response = await fetch(`./pm/${side}-nets.svg`);
  if (!response.ok) {
    throw new Error(`Failed to load ${side} nets (${response.status})`);
  }

  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  const groupsPayload = svg?.dataset?.netGroups;
  if (groupsPayload) {
    try {
      absorbViewerGroups(JSON.parse(groupsPayload));
    } catch (error) {
      console.warn('Could not parse data-net-groups from SVG', error);
    }
  }

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
      netKey: visibilityKey(netId),
      label: path.dataset.netLabel || netId,
      category: path.dataset.category || 'uncategorized',
      color: path.dataset.color || path.getAttribute('stroke') || '#00d9ff',
      visible: isNetVisible(side, netId),
    });
  });

  return Array.from(nets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function legendSections(rows) {
  if (!netState.groups.length) {
    return [{ id: null, title: null, rows }];
  }

  const rowByKey = new Map();
  rows.forEach((row) => {
    if (!row?.netKey || rowByKey.has(row.netKey)) return;
    rowByKey.set(row.netKey, row);
  });

  const used = new Set();
  const sections = [];
  const groups = [...netState.groups].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });

  groups.forEach((group) => {
    const groupedRows = normalizeGroupNetIds(group.netIds)
      .map((key) => rowByKey.get(key))
      .filter((row) => row && !used.has(row.netId))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!groupedRows.length) return;
    groupedRows.forEach((row) => used.add(row.netId));
    sections.push({ id: group.id, title: group.name, rows: groupedRows });
  });

  const ungrouped = rows.filter((row) => !used.has(row.netId));
  if (ungrouped.length) {
    sections.push({ id: 'ungrouped', title: 'Ungrouped', rows: ungrouped });
  }

  return sections.length ? sections : [{ id: null, title: null, rows }];
}

function updateLegendSelectionState() {
  const hoveredKey = netState.hoveredNetKey;
  const selectedNetId = netState.selectedNetId;
  legendList.querySelectorAll('li[data-net-key]').forEach((li) => {
    const rowKey = visibilityKey(li.dataset.netKey || '');
    const rowNetId = String(li.dataset.netId || '');
    const selectedByPathHover = !!rowKey && rowKey === hoveredKey;
    const selectedByPinnedNet = !!rowNetId && rowNetId === selectedNetId;
    li.classList.toggle('is-selected', selectedByPathHover || selectedByPinnedNet);
  });
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
  let optionIndex = 0;
  legendSections(rows).forEach((section) => {
    if (section.title) {
      const heading = document.createElement('li');
      heading.className = 'legend-group-title';
      const button = document.createElement('button');
      button.type = 'title';
      button.className = 'legend-group-toggle';
      const allVisible = section.rows.every((row) => row.visible);
      button.title = allVisible ? 'Hide all nets in this group' : 'Show all nets in this group';
      button.textContent = section.title;
      button.addEventListener('click', () => {
        setSectionVisibility(section.rows, !allVisible);
      });
      heading.append(button);
      legendList.append(heading);
    }

    section.rows.forEach((row) => {
      const li = document.createElement('li');
      li.dataset.netKey = row.netKey || '';
      li.dataset.netId = row.netId || '';
      if (!row.visible) li.classList.add('is-hidden');

      const label = document.createElement('label');
      label.className = 'legend-row';
      label.title = row.visible ? 'Hide this net' : 'Show this net';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'legend-toggle';
      toggle.checked = row.visible;
      toggle.id = `legend-toggle-${side}-${optionIndex++}`;
      toggle.style.setProperty('--swatch-color', row.color);
      toggle.addEventListener('change', () => {
        setNetVisibility(side, row.netId, toggle.checked);
        if (toggle.checked) selectNet(row.netId);
      });

      const text = document.createElement('span');
      text.innerHTML = `<strong>${row.label}</strong>`;

      label.append(toggle, text);
      li.append(label);
      legendList.append(li);
    });
  });
  updateLegendSelectionState();
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
moveTo(2);
resetView();

Promise.allSettled(NET_SIDES.map((side) => loadNetOverlay(side))).then((results) => {
  netState.loaded = true;
  applyGroupDefaultsOnce();
  NET_SIDES.forEach((side) => applyNetVisibilityForSide(side));

  const failed = results.find((res) => res.status === 'rejected');
  if (failed) {
    legendEmpty.hidden = false;
    legendEmpty.textContent = 'Could not load one or more SVG net files.';
    console.error(failed.reason);
  }

  updateAllLayers();
});
