const SVG_NS = 'http://www.w3.org/2000/svg';
const CANVAS_SIZE = 1765;
const STORAGE_KEY = 'pcb-xray-net-editor-v2';
const MAX_UNDO_ENTRIES = 100;
const ANCHOR_HIT_RADIUS_PX = 9;
const ANCHOR_MARKER_RADIUS_PX = 2.3;
const ANCHOR_MARKER_SELECTED_RADIUS_PX = 3.2;

const elements = {
  side: document.querySelector('#side'),
  layerImage: document.querySelector('#layer-image'),
  reloadSide: document.querySelector('#reload-side'),
  importSide: document.querySelector('#import-side'),
  importSideFile: document.querySelector('#import-side-file'),
  exportSide: document.querySelector('#export-side'),
  zoomReset: document.querySelector('#zoom-reset'),
  mirror: document.querySelector('#mirror'),
  zoomReadout: document.querySelector('#zoom-readout'),
  viewport: document.querySelector('#viewport'),
  scene: document.querySelector('#scene'),
  baseImage: document.querySelector('#base-image'),
  overlay: document.querySelector('#overlay'),
  toolButtons: Array.from(document.querySelectorAll('[data-tool]')),
  netId: document.querySelector('#net-id'),
  netLabel: document.querySelector('#net-label'),
  category: document.querySelector('#net-category'),
  color: document.querySelector('#net-color'),
  debugFillOpacity: document.querySelector('#debug-fill-opacity'),
  debugFillOpacityReadout: document.querySelector('#debug-fill-opacity-readout'),
  strokeWidth: document.querySelector('#stroke-width'),
  applyMeta: document.querySelector('#apply-meta'),
  deletePath: document.querySelector('#delete-path'),
  undoEdit: document.querySelector('#undo-edit'),
  toggleBezier: document.querySelector('#toggle-bezier'),
  simplifyEpsilon: document.querySelector('#simplify-epsilon'),
  smoothStrength: document.querySelector('#smooth-strength'),
  simplifyPath: document.querySelector('#simplify-path'),
  smoothPath: document.querySelector('#smooth-path'),
  magnetRadius: document.querySelector('#magnet-radius'),
  magnetThreshold: document.querySelector('#magnet-threshold'),
  magnetStrength: document.querySelector('#magnet-strength'),
  pathList: document.querySelector('#path-list'),
  nodeMenu: document.querySelector('#node-menu'),
  nodeMenuTitle: document.querySelector('#node-menu-title'),
  menuAddNode: document.querySelector('#menu-add-node'),
  menuDeleteNode: document.querySelector('#menu-delete-node'),
  status: document.querySelector('#status'),
};

const state = {
  tool: 'select',
  side: 'front',
  layerImage: 1,
  debugFillOpacity: 0.18,
  zoom: 1,
  panX: 20,
  panY: 20,
  isSpaceDown: false,
  panning: null,
  drawing: null,
  anchorDrag: null,
  suppressOverlayClick: false,
  nodeMenuState: null,
  selectedUid: null,
  selectedAnchorIndex: null,
  drawPoints: [],
  nextUid: 1,
  isApplyingUndo: false,
  undo: {
    front: [],
    back: [],
  },
  raster: {
    canvas: document.createElement('canvas'),
    ctx: null,
    imageData: null,
    edgeMap: null,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  },
  sides: {
    front: {
      loaded: false,
      paths: [],
    },
    back: {
      loaded: false,
      paths: [],
    },
  },
};

state.raster.canvas.width = CANVAS_SIZE;
state.raster.canvas.height = CANVAS_SIZE;
state.raster.ctx = state.raster.canvas.getContext('2d', { willReadFrequently: true });

function setStatus(text) {
  elements.status.textContent = text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value, fallback = '#ffe05e') {
  const raw = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const shortMatch = raw.match(/^#([0-9a-f]{3})$/);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function setDebugFillOpacity(value, options = {}) {
  const { save = false, announce = false } = options;
  const next = clamp(parseFloat(value) || 0, 0, 1);
  state.debugFillOpacity = next;
  elements.debugFillOpacity.value = next.toFixed(2);
  elements.debugFillOpacityReadout.textContent = next.toFixed(2);
  renderOverlay();
  if (announce) setStatus(`Debug fill opacity: ${next.toFixed(2)}`);
  if (save) saveDraft();
}

function editableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function currentLayerColor() {
  const fallback = '#ffe05e';
  const next = normalizeHexColor(elements.color.value, fallback);
  if (elements.color.value !== next) {
    elements.color.value = next;
  }
  return next;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pointDistance2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function zoomSafe() {
  return Math.max(state.zoom, 0.0001);
}

function applyAnchorScreenScale(node, x, y) {
  const inv = 1 / zoomSafe();
  const cx = Number(x);
  const cy = Number(y);
  node.setAttribute(
    'transform',
    `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${inv.toFixed(6)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`
  );
}

function pointToSegmentDistance2(point, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return pointDistance2(point, a);

  const t = clamp((apx * abx + apy * aby) / len2, 0, 1);
  const px = a[0] + abx * t;
  const py = a[1] + aby * t;
  const dx = point[0] - px;
  const dy = point[1] - py;
  return dx * dx + dy * dy;
}

function perpendicularDistance(point, lineStart, lineEnd) {
  return Math.sqrt(pointToSegmentDistance2(point, lineStart, lineEnd));
}

function serializePoints(points) {
  return points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(';');
}

function serializePointModes(pointModes) {
  if (!Array.isArray(pointModes)) return '';
  return pointModes.map((mode) => (mode === 'smooth' ? 's' : 'c')).join(';');
}

function parsePoints(value) {
  if (!value || typeof value !== 'string') return null;

  const parsed = value
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [x, y] = chunk.split(',').map((token) => parseFloat(token));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [clamp(x, 0, CANVAS_SIZE), clamp(y, 0, CANVAS_SIZE)];
    })
    .filter(Boolean);

  if (parsed.length < 3) return null;
  return parsed;
}

function parsePointModes(value, expectedLength) {
  if (!value || typeof value !== 'string') return null;

  const parsed = value
    .split(';')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .map((token) => (token === 's' || token === 'smooth' ? 'smooth' : 'corner'));

  if (!parsed.length) return null;
  if (Number.isInteger(expectedLength) && expectedLength > 0 && parsed.length !== expectedLength) {
    return null;
  }

  return parsed;
}

function extractPointsFromSimplePath(d) {
  if (!d) return null;
  if (/[CQSTAHV]/i.test(d)) return null;

  const numbers = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  if (numbers.length < 6 || numbers.length % 2 !== 0) return null;

  const points = [];
  for (let i = 0; i < numbers.length; i += 2) {
    points.push([
      clamp(numbers[i], 0, CANVAS_SIZE),
      clamp(numbers[i + 1], 0, CANVAS_SIZE),
    ]);
  }

  if (points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01) {
      points.pop();
    }
  }

  return points.length >= 3 ? points : null;
}

function pointsToPath(points, pointModes = null, closed = true) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const n = points.length;
  const modes = Array.isArray(pointModes) && pointModes.length === n
    ? pointModes
    : Array.from({ length: n }, () => 'corner');

  const commands = [`M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`];
  const segmentCount = closed ? n : n - 1;

  for (let i = 0; i < segmentCount; i += 1) {
    const currIndex = i;
    const nextIndex = (i + 1) % n;
    const curr = points[currIndex];
    const next = points[nextIndex];

    const prev = points[(currIndex - 1 + n) % n];
    const nextNext = points[(nextIndex + 1) % n];

    const currSmooth = modes[currIndex] === 'smooth';
    const nextSmooth = modes[nextIndex] === 'smooth';

    if (!currSmooth && !nextSmooth) {
      commands.push(`L ${next[0].toFixed(2)} ${next[1].toFixed(2)}`);
      continue;
    }

    const tension = 1 / 6;
    const currTangent = currSmooth
      ? [(next[0] - prev[0]) * tension, (next[1] - prev[1]) * tension]
      : [0, 0];
    const nextTangent = nextSmooth
      ? [(nextNext[0] - curr[0]) * tension, (nextNext[1] - curr[1]) * tension]
      : [0, 0];

    const c1x = curr[0] + currTangent[0];
    const c1y = curr[1] + currTangent[1];
    const c2x = next[0] - nextTangent[0];
    const c2y = next[1] - nextTangent[1];

    commands.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${next[0].toFixed(2)} ${next[1].toFixed(2)}`
    );
  }

  if (closed) commands.push('Z');
  return commands.join(' ');
}

function simplifyRdpOpen(points, epsilon) {
  if (!Array.isArray(points) || points.length < 3) return points ? [...points] : [];

  let maxDistance = -1;
  let index = -1;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > epsilon && index > 0) {
    const left = simplifyRdpOpen(points.slice(0, index + 1), epsilon);
    const right = simplifyRdpOpen(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function simplifyClosedPolygon(points, epsilon) {
  if (!Array.isArray(points) || points.length < 4) {
    return points ? points.map((point) => [...point]) : [];
  }

  const ring = [...points, points[0]];
  let simplified = simplifyRdpOpen(ring, epsilon);
  if (simplified.length > 1 && pointDistance2(simplified[0], simplified[simplified.length - 1]) < 1e-4) {
    simplified = simplified.slice(0, -1);
  }

  if (simplified.length < 3) return points.map((point) => [...point]);
  return simplified.map((point) => [point[0], point[1]]);
}

function smoothClosedPolygon(points, strength) {
  if (!Array.isArray(points) || points.length < 3) {
    return points ? points.map((point) => [...point]) : [];
  }

  const alpha = clamp(strength, 0.01, 1);
  const n = points.length;
  const output = [];

  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];

    const avgX = (prev[0] + next[0]) / 2;
    const avgY = (prev[1] + next[1]) / 2;

    output.push([
      cur[0] * (1 - alpha) + avgX * alpha,
      cur[1] * (1 - alpha) + avgY * alpha,
    ]);
  }

  return output;
}

function buildEdgeMap(imageData) {
  if (!imageData) return null;

  const width = imageData.width;
  const height = imageData.height;
  const rgba = imageData.data;
  const length = width * height;

  const luma = new Float32Array(length);
  const edge = new Uint8Array(length);

  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    luma[i] = rgba[p] * 0.2126 + rgba[p + 1] * 0.7152 + rgba[p + 2] * 0.0722;
  }

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;

      const tl = luma[i - width - 1];
      const tc = luma[i - width];
      const tr = luma[i - width + 1];
      const ml = luma[i - 1];
      const mr = luma[i + 1];
      const bl = luma[i + width - 1];
      const bc = luma[i + width];
      const br = luma[i + width + 1];

      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edge[i] = clamp(Math.round(magnitude / 4), 0, 255);
    }
  }

  return edge;
}

function magnetSnapPoint(point, previousPoint = null) {
  const edgeMap = state.raster.edgeMap;
  if (!edgeMap) return point;

  const width = state.raster.width;
  const height = state.raster.height;
  const radius = clamp(parseInt(elements.magnetRadius.value, 10) || 10, 2, 60);
  const threshold = clamp(parseInt(elements.magnetThreshold.value, 10) || 35, 1, 255);
  const strength = clamp(parseFloat(elements.magnetStrength.value) || 1.6, 0.2, 5);

  const cx = clamp(Math.round(point[0]), 0, width - 1);
  const cy = clamp(Math.round(point[1]), 0, height - 1);

  let bestX = cx;
  let bestY = cy;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestEdge = 0;

  const minX = clamp(cx - radius, 0, width - 1);
  const maxX = clamp(cx + radius, 0, width - 1);
  const minY = clamp(cy - radius, 0, height - 1);
  const maxY = clamp(cy + radius, 0, height - 1);
  const maxRadius2 = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > maxRadius2) continue;

      const edge = edgeMap[row + x];
      let score = edge * strength - dist2 * 1.2;

      if (previousPoint) {
        const pdx = x - previousPoint[0];
        const pdy = y - previousPoint[1];
        score -= Math.sqrt(pdx * pdx + pdy * pdy) * 0.2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEdge = edge;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestEdge < threshold) return point;
  return [bestX, bestY];
}

function normalizePointModes(pointModes, length, fallbackMode = 'corner') {
  const fallback = fallbackMode === 'smooth' ? 'smooth' : 'corner';
  if (!Number.isInteger(length) || length <= 0) return [];

  if (!Array.isArray(pointModes) || pointModes.length !== length) {
    return Array.from({ length }, () => fallback);
  }

  return pointModes.map((mode) => (mode === 'smooth' ? 'smooth' : 'corner'));
}

function inferFallbackModeFromPath(rawD, legacyCurveMode) {
  if (legacyCurveMode === 'bezier') return 'smooth';
  if (legacyCurveMode === 'poly') return 'corner';
  if (typeof rawD === 'string' && /C\s/i.test(rawD)) return 'smooth';
  return 'corner';
}

function normalizePath(raw) {
  const d = String(raw?.d || '').trim();
  const netId = String(raw?.netId || '').trim() || `net-${Date.now()}`;
  const netLabel = String(raw?.netLabel || '').trim() || netId;
  const category = String(raw?.category || 'signal').trim() || 'signal';
  const color = String(raw?.color || '#ffe05e').trim() || '#ffe05e';
  const strokeWidth = clamp(parseFloat(raw?.strokeWidth) || 1, 0.1, 20);

  let points = null;
  if (Array.isArray(raw?.points)) {
    points = raw.points
      .map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        const x = parseFloat(pair[0]);
        const y = parseFloat(pair[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return [clamp(x, 0, CANVAS_SIZE), clamp(y, 0, CANVAS_SIZE)];
      })
      .filter(Boolean);

    if (points.length < 3) points = null;
  }

  if (!points) points = parsePoints(raw?.editorPoints || '');
  if (!points) points = extractPointsFromSimplePath(d);

  const parsedPointModes = parsePointModes(
    raw?.editorPointModes || raw?.pointModes || '',
    points ? points.length : undefined
  );
  const fallbackMode = inferFallbackModeFromPath(d, raw?.curveMode);
  const pointModes = points
    ? normalizePointModes(parsedPointModes, points.length, fallbackMode)
    : [];

  let finalD = d;
  if ((!finalD || !finalD.length) && points) {
    finalD = pointsToPath(points, pointModes, true);
  }
  if (!finalD || !finalD.length) return null;

  return {
    uid: String(raw?.uid || ''),
    d: finalD,
    netId,
    netLabel,
    category,
    color,
    strokeWidth,
    points,
    pointModes,
  };
}

function cloneSerializablePath(path) {
  return {
    uid: String(path.uid || ''),
    d: String(path.d || ''),
    netId: String(path.netId || ''),
    netLabel: String(path.netLabel || ''),
    category: String(path.category || 'signal'),
    color: String(path.color || '#ffe05e'),
    strokeWidth: clamp(parseFloat(path.strokeWidth) || 1, 0.1, 20),
    points: Array.isArray(path.points)
      ? path.points.map((point) => [Number(point[0]), Number(point[1])])
      : null,
    pointModes: Array.isArray(path.pointModes)
      ? path.pointModes.map((mode) => (mode === 'smooth' ? 'smooth' : 'corner'))
      : null,
  };
}

function maxPathUid(paths) {
  let max = 0;
  paths.forEach((path) => {
    const match = String(path.uid || '').match(/^p-(\d+)$/);
    if (!match) return;
    max = Math.max(max, parseInt(match[1], 10));
  });
  return max;
}

function normalizeSide(value) {
  return value === 'back' ? 'back' : 'front';
}

function resetUndoStack(side = state.side) {
  const targetSide = normalizeSide(side);
  state.undo[targetSide] = [];
}

function inferNextUidFloor() {
  return Math.max(
    maxPathUid(state.sides.front.paths),
    maxPathUid(state.sides.back.paths)
  ) + 1;
}

function recordUndoSnapshot(label, details = {}) {
  if (state.isApplyingUndo) return;

  const side = normalizeSide(state.side);
  const stack = state.undo[side];
  const path = details.path || null;
  const hasLayerColor = Object.prototype.hasOwnProperty.call(details, 'layerColor');
  const snapshot = {
    side,
    label: String(label || 'Edit').trim() || 'Edit',
    pathUid: details.pathUid || (path && path.uid) || null,
    pathLabel: details.pathLabel || (path && path.netLabel) || null,
    selectedUid: state.selectedUid,
    selectedAnchorIndex: Number.isInteger(state.selectedAnchorIndex) ? state.selectedAnchorIndex : null,
    nextUid: state.nextUid,
    layerColor: hasLayerColor ? details.layerColor : currentLayerColor(),
    paths: state.sides[side].paths.map(cloneSerializablePath),
  };

  stack.push(snapshot);
  if (stack.length > MAX_UNDO_ENTRIES) {
    stack.shift();
  }
}

function undoLastEdit({ announce = true } = {}) {
  const side = normalizeSide(state.side);
  const stack = state.undo[side];
  if (!stack.length) {
    if (announce) setStatus('Nothing to undo on this side.');
    return false;
  }

  const snapshot = stack.pop();
  if (!snapshot) {
    if (announce) setStatus('Nothing to undo on this side.');
    return false;
  }

  state.isApplyingUndo = true;
  try {
    const restored = (Array.isArray(snapshot.paths) ? snapshot.paths : [])
      .map(normalizePath)
      .filter(Boolean)
      .map((path) => cloneSerializablePath(path));
    state.sides[side].paths = restored;
    state.sides[side].loaded = true;

    const requestedNextUid = parseInt(snapshot.nextUid, 10);
    const nextUidFloor = inferNextUidFloor();
    state.nextUid = Number.isFinite(requestedNextUid)
      ? Math.max(requestedNextUid, nextUidFloor)
      : Math.max(state.nextUid, nextUidFloor);

    if (typeof snapshot.layerColor === 'string') {
      elements.color.value = normalizeHexColor(snapshot.layerColor, '#ffe05e');
    } else {
      syncLayerColorFromCurrentSide();
    }

    state.selectedUid = typeof snapshot.selectedUid === 'string' ? snapshot.selectedUid : null;
    state.selectedAnchorIndex = Number.isInteger(snapshot.selectedAnchorIndex)
      ? snapshot.selectedAnchorIndex
      : null;
    ensureSelectedPath();
    if (state.selectedUid) assignFormDefaults(activePath());
    refreshPathList();
    renderOverlay();
    saveDraft();
  } finally {
    state.isApplyingUndo = false;
  }

  if (announce) {
    const target = snapshot.pathLabel || snapshot.pathUid || 'current side';
    setStatus(`Undo: ${snapshot.label} (${target}).`);
  }
  return true;
}

function saveDraft(silent = true) {
  try {
    const snapshot = {
      version: 2,
      side: state.side,
      layerImage: state.layerImage,
      tool: state.tool,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      mirror: !!elements.mirror.checked,
      nextUid: state.nextUid,
      selectedUid: state.selectedUid,
      selectedAnchorIndex: state.selectedAnchorIndex,
      form: {
        netId: elements.netId.value,
        netLabel: elements.netLabel.value,
        category: elements.category.value,
        color: elements.color.value,
        debugFillOpacity: elements.debugFillOpacity.value,
        strokeWidth: elements.strokeWidth.value,
        simplifyEpsilon: elements.simplifyEpsilon.value,
        smoothStrength: elements.smoothStrength.value,
        magnetRadius: elements.magnetRadius.value,
        magnetThreshold: elements.magnetThreshold.value,
        magnetStrength: elements.magnetStrength.value,
      },
      sides: {
        front: state.sides.front.paths.map(cloneSerializablePath),
        back: state.sides.back.paths.map(cloneSerializablePath),
      },
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    if (!silent) setStatus('Draft saved to local storage.');
  } catch (error) {
    console.warn('Could not save local draft', error);
    if (!silent) setStatus('Could not save local draft.');
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;

    state.side = data.side === 'back' ? 'back' : 'front';
    elements.side.value = state.side;

    state.layerImage = clamp(parseInt(data.layerImage, 10) || 1, 1, 6);
    elements.layerImage.value = String(state.layerImage);

    const validTools = ['select', 'polygon', 'magnet', 'pan'];
    state.tool = validTools.includes(data.tool) ? data.tool : 'select';

    state.zoom = clamp(parseFloat(data.zoom) || 1, 0.25, 40);
    state.panX = Number.isFinite(data.panX) ? data.panX : 20;
    state.panY = Number.isFinite(data.panY) ? data.panY : 20;
    elements.mirror.checked = !!data.mirror;

    const frontRaw = Array.isArray(data?.sides?.front) ? data.sides.front : [];
    const backRaw = Array.isArray(data?.sides?.back) ? data.sides.back : [];

    state.sides.front.paths = frontRaw
      .map(normalizePath)
      .filter(Boolean)
      .map((path, i) => ({ ...path, uid: path.uid || `p-${i + 1}` }));

    const offset = state.sides.front.paths.length;
    state.sides.back.paths = backRaw
      .map(normalizePath)
      .filter(Boolean)
      .map((path, i) => ({ ...path, uid: path.uid || `p-${offset + i + 1}` }));

    state.sides.front.loaded = true;
    state.sides.back.loaded = true;

    const inferredNextUid = Math.max(
      maxPathUid(state.sides.front.paths),
      maxPathUid(state.sides.back.paths)
    ) + 1;

    const explicitNextUid = parseInt(data.nextUid, 10);
    state.nextUid = Number.isFinite(explicitNextUid)
      ? Math.max(explicitNextUid, inferredNextUid)
      : inferredNextUid;

    state.selectedUid = typeof data.selectedUid === 'string' ? data.selectedUid : null;
    state.selectedAnchorIndex = Number.isInteger(data.selectedAnchorIndex)
      ? data.selectedAnchorIndex
      : null;

    if (data.form && typeof data.form === 'object') {
      elements.netId.value = String(data.form.netId || '');
      elements.netLabel.value = String(data.form.netLabel || '');
      elements.category.value = String(data.form.category || 'signal');
      elements.color.value = normalizeHexColor(String(data.form.color || '#ffe05e'), '#ffe05e');
      const debugFillOpacity = clamp(parseFloat(data.form.debugFillOpacity) || 0.18, 0, 1);
      state.debugFillOpacity = debugFillOpacity;
      elements.debugFillOpacity.value = debugFillOpacity.toFixed(2);
      elements.debugFillOpacityReadout.textContent = debugFillOpacity.toFixed(2);
      elements.strokeWidth.value = String(data.form.strokeWidth || '1');
      elements.simplifyEpsilon.value = String(data.form.simplifyEpsilon || '3');
      elements.smoothStrength.value = String(data.form.smoothStrength || '0.25');
      elements.magnetRadius.value = String(data.form.magnetRadius || '10');
      elements.magnetThreshold.value = String(data.form.magnetThreshold || '35');
      elements.magnetStrength.value = String(data.form.magnetStrength || '1.6');
    }

    return true;
  } catch (error) {
    console.warn('Could not restore local draft', error);
    return false;
  }
}

function currentPaths() {
  return state.sides[state.side].paths;
}

function syncLayerColorFromCurrentSide() {
  const paths = currentPaths();
  const firstWithColor = paths.find((path) => typeof path.color === 'string' && path.color.trim().length > 0);
  if (firstWithColor) {
    elements.color.value = normalizeHexColor(firstWithColor.color, '#ffe05e');
    return;
  }
  elements.color.value = currentLayerColor();
}

function applyLayerColorToCurrentSide(color, options = {}) {
  const { save = true, announce = false, recordUndo = false } = options;
  const previousLayerColor = currentLayerColor();
  const layerColor = normalizeHexColor(color, '#ffe05e');
  const paths = currentPaths();
  const hasChange = paths.some((path) => normalizeHexColor(path.color, layerColor) !== layerColor);
  if (recordUndo && hasChange) {
    recordUndoSnapshot('Change layer color', { layerColor: previousLayerColor });
  }
  elements.color.value = layerColor;
  paths.forEach((path) => {
    path.color = layerColor;
  });
  renderOverlay();
  if (announce) {
    const suffix = paths.length ? ` to ${paths.length} path(s)` : ' for new paths';
    setStatus(`Applied layer color${suffix}.`);
  }
  if (save) saveDraft();
}

function activePath() {
  if (!state.selectedUid) return null;
  return currentPaths().find((entry) => entry.uid === state.selectedUid) || null;
}

function ensureSelectedPath() {
  const paths = currentPaths();
  if (!paths.length) {
    state.selectedUid = null;
    state.selectedAnchorIndex = null;
    return;
  }

  if (!state.selectedUid || !paths.some((entry) => entry.uid === state.selectedUid)) {
    state.selectedUid = paths[0].uid;
    state.selectedAnchorIndex = null;
  }

  const selectedPath = activePath();
  if (!selectedPath || !Array.isArray(selectedPath.points)) {
    state.selectedAnchorIndex = null;
    return;
  }
  if (!Number.isInteger(state.selectedAnchorIndex)) return;
  if (state.selectedAnchorIndex < 0 || state.selectedAnchorIndex >= selectedPath.points.length) {
    state.selectedAnchorIndex = null;
  }
}

function updatePathGeometry(path) {
  if (!path || !Array.isArray(path.points) || path.points.length < 3) return;
  path.pointModes = normalizePointModes(path.pointModes, path.points.length, 'corner');
  path.d = pointsToPath(path.points, path.pointModes, true);
}

function findNearestSegmentIndex(points, point) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const distance = pointToSegmentDistance2(point, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function hideNodeMenu() {
  state.nodeMenuState = null;
  elements.nodeMenu.hidden = true;
}

function showNodeMenu({ clientX, clientY, mode, anchorIndex = null, point = null }) {
  state.nodeMenuState = { mode, anchorIndex, point };

  const allowDelete = Number.isInteger(anchorIndex);
  elements.menuAddNode.hidden = false;
  elements.menuDeleteNode.hidden = !allowDelete;

  elements.nodeMenuTitle.textContent = allowDelete
    ? 'Anchor actions'
    : 'Path actions';

  elements.nodeMenu.hidden = false;

  const pad = 8;
  const rect = elements.nodeMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;
  const x = clamp(clientX, pad, Math.max(pad, maxX));
  const y = clamp(clientY, pad, Math.max(pad, maxY));

  elements.nodeMenu.style.left = `${x}px`;
  elements.nodeMenu.style.top = `${y}px`;
}

function updateSceneTransform() {
  if (elements.mirror.checked) {
    const shiftX = state.panX + state.zoom * CANVAS_SIZE;
    elements.scene.style.transform = `translate(${shiftX}px, ${state.panY}px) scale(${-state.zoom}, ${state.zoom})`;
  } else {
    elements.scene.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom}, ${state.zoom})`;
  }
  elements.zoomReadout.textContent = `Zoom: ${state.zoom.toFixed(2)}x`;
}

function normalizeLayerForSide() {
  if (state.side === 'front' && state.layerImage > 3) state.layerImage = 1;
  if (state.side === 'back' && state.layerImage < 4) state.layerImage = 4;
  elements.layerImage.value = String(state.layerImage);
}

function loadBaseImage() {
  return new Promise((resolve) => {
    elements.baseImage.onload = () => {
      try {
        state.raster.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        state.raster.ctx.drawImage(elements.baseImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        state.raster.imageData = state.raster.ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        state.raster.edgeMap = buildEdgeMap(state.raster.imageData);
      } catch (error) {
        state.raster.imageData = null;
        state.raster.edgeMap = null;
        console.warn('Could not build magnet map from base image', error);
      }
      resolve();
    };
    elements.baseImage.onerror = () => {
      setStatus('Failed to load base JPG.');
      state.raster.imageData = null;
      state.raster.edgeMap = null;
      resolve();
    };

    elements.baseImage.src = `./pm/${state.layerImage}.jpg`;
  });
}

function setTool(tool, options = {}) {
  const { save = true, announce = true } = options;
  if (!['select', 'polygon', 'magnet', 'pan'].includes(tool)) return;

  state.tool = tool;
  state.drawPoints = [];
  state.drawing = null;
  if (tool !== 'select') {
    state.selectedAnchorIndex = null;
  }
  hideNodeMenu();

  elements.toolButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === tool);
  });

  renderOverlay();

  if (announce) {
    if (tool === 'polygon') {
      setStatus('Tool: polygon. Drag on the board to draw a new closed net shape.');
    } else if (tool === 'magnet') {
      setStatus('Tool: magnet. Drag to trace with snapping to nearby PCB edges.');
    } else {
      setStatus(`Tool: ${tool}`);
    }
  }

  if (save) saveDraft();
}

function assignFormDefaults(path) {
  if (!path) return;
  elements.netId.value = path.netId;
  elements.netLabel.value = path.netLabel;
  elements.category.value = path.category;
  elements.strokeWidth.value = String(path.strokeWidth);
}

function readPathMetaFromForm() {
  const providedId = elements.netId.value.trim();
  const netId = providedId || `net-${Date.now()}`;
  const providedLabel = elements.netLabel.value.trim();

  return {
    netId,
    netLabel: providedLabel || netId,
    category: elements.category.value,
    color: currentLayerColor(),
    strokeWidth: clamp(parseFloat(elements.strokeWidth.value) || 1, 0.1, 20),
  };
}

function refreshPathList() {
  const paths = currentPaths();
  elements.pathList.innerHTML = '';

  paths.forEach((path) => {
    const option = document.createElement('option');
    option.value = path.uid;
    const modes = Array.isArray(path.pointModes) ? path.pointModes : [];
    const hasSmooth = modes.some((mode) => mode === 'smooth');
    const hasCorner = modes.some((mode) => mode !== 'smooth');
    const mode = hasSmooth && hasCorner ? 'mixed' : hasSmooth ? 'smooth' : 'corner';
    option.textContent = `${path.netLabel} (${path.category}, ${mode})`;
    option.selected = path.uid === state.selectedUid;
    elements.pathList.append(option);
  });
}

function selectPath(uid, options = {}) {
  const { save = true, bringIntoView = true } = options;
  state.selectedUid = uid;
  state.selectedAnchorIndex = null;
  const path = activePath();
  if (path) assignFormDefaults(path);

  refreshPathList();
  renderOverlay();
  if (path && bringIntoView) ensurePathVisible(path);
  if (save) saveDraft();
}

function selectAdjacentPath(delta) {
  const paths = currentPaths();
  if (!paths.length) return;

  let currentIndex = paths.findIndex((entry) => entry.uid === state.selectedUid);
  if (currentIndex === -1) currentIndex = 0;

  const step = delta >= 0 ? 1 : -1;
  const nextIndex = (currentIndex + step + paths.length) % paths.length;
  selectPath(paths[nextIndex].uid, { save: true });
  setStatus(`Selected ${paths[nextIndex].netLabel}.`);
}

function pathBoundsFromPoints(path) {
  if (!path || !Array.isArray(path.points) || path.points.length < 1) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  path.points.forEach((point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function pathBoundsFromRendered(path) {
  if (!path) return null;
  const visual = elements.overlay.querySelector(`.net-path[data-uid="${CSS.escape(path.uid)}"]`);
  if (!visual || typeof visual.getBBox !== 'function') return null;
  try {
    const box = visual.getBBox();
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
      return null;
    }
    return {
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.width,
      maxY: box.y + box.height,
    };
  } catch {
    return null;
  }
}

function worldToScreenX(x) {
  if (elements.mirror.checked) {
    return state.panX + (CANVAS_SIZE - x) * state.zoom;
  }
  return state.panX + x * state.zoom;
}

function worldToScreenY(y) {
  return state.panY + y * state.zoom;
}

function ensurePathVisible(path) {
  if (!path) return;

  const bounds = pathBoundsFromPoints(path) || pathBoundsFromRendered(path);
  if (!bounds) return;

  const viewportWidth = elements.viewport.clientWidth;
  const viewportHeight = elements.viewport.clientHeight;
  if (!viewportWidth || !viewportHeight) return;

  const screenX1 = worldToScreenX(bounds.minX);
  const screenX2 = worldToScreenX(bounds.maxX);
  const left = Math.min(screenX1, screenX2);
  const right = Math.max(screenX1, screenX2);
  const top = worldToScreenY(bounds.minY);
  const bottom = worldToScreenY(bounds.maxY);

  const padding = 64;
  const visibleHorizontally = right >= padding && left <= viewportWidth - padding;
  const visibleVertically = bottom >= padding && top <= viewportHeight - padding;
  if (visibleHorizontally && visibleVertically) return;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  if (elements.mirror.checked) {
    state.panX = viewportWidth / 2 - (CANVAS_SIZE - centerX) * state.zoom;
  } else {
    state.panX = viewportWidth / 2 - centerX * state.zoom;
  }
  state.panY = viewportHeight / 2 - centerY * state.zoom;
  updateSceneTransform();
}

function createPathElements(path) {
  const visual = document.createElementNS(SVG_NS, 'path');
  visual.setAttribute('d', path.d);
  visual.setAttribute('stroke', path.color);
  visual.setAttribute('stroke-width', String(path.strokeWidth));
  visual.setAttribute('fill', path.color);
  visual.setAttribute('fill-opacity', state.debugFillOpacity.toFixed(2));
  visual.setAttribute('class', 'net-path is-selected');
  visual.dataset.uid = path.uid;

  const hit = visual.cloneNode(false);
  hit.setAttribute('class', 'net-hit');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', String(Math.max(8, path.strokeWidth * 10)));
  hit.dataset.uid = path.uid;

  return [visual, hit];
}

function createAnchorElements(path) {
  if (!Array.isArray(path.points) || path.points.length < 3) return [];

  return path.points.flatMap((point, index) => {
    const [x, y] = point;
    const isSelected = state.selectedAnchorIndex === index;

    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', x.toFixed(2));
    hit.setAttribute('cy', y.toFixed(2));
    hit.setAttribute('r', ANCHOR_HIT_RADIUS_PX.toFixed(2));
    hit.setAttribute('class', 'net-anchor-hit');
    hit.dataset.uid = path.uid;
    hit.dataset.anchorIndex = String(index);
    applyAnchorScreenScale(hit, x, y);

    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('cx', x.toFixed(2));
    marker.setAttribute('cy', y.toFixed(2));
    marker.setAttribute('r', (isSelected ? ANCHOR_MARKER_SELECTED_RADIUS_PX : ANCHOR_MARKER_RADIUS_PX).toFixed(2));
    marker.setAttribute('class', 'net-anchor');
    if (path.pointModes?.[index] === 'smooth') {
      marker.classList.add('is-smooth');
    }
    if (isSelected) {
      marker.classList.add('is-selected');
    }
    marker.dataset.uid = path.uid;
    marker.dataset.anchorIndex = String(index);
    applyAnchorScreenScale(marker, x, y);

    return [hit, marker];
  });
}

function renderOverlay() {
  elements.overlay.innerHTML = '';

  const path = activePath();
  if (path) {
    const [visual, hit] = createPathElements(path);
    elements.overlay.append(visual, hit, ...createAnchorElements(path));
  }

  if (state.drawPoints.length > 1) {
    const draft = document.createElementNS(SVG_NS, 'path');
    const d = pointsToPath(state.drawPoints, null, true);
    if (d) draft.setAttribute('d', d);
    draft.setAttribute('class', 'net-draft');
    const layerColor = currentLayerColor();
    draft.setAttribute('stroke', layerColor);
    draft.setAttribute('fill', layerColor);
    draft.setAttribute('fill-opacity', state.debugFillOpacity.toFixed(2));
    elements.overlay.append(draft);
  } else if (state.drawPoints.length === 1) {
    const point = state.drawPoints[0];
    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('cx', point[0].toFixed(2));
    marker.setAttribute('cy', point[1].toFixed(2));
    marker.setAttribute('r', '2');
    marker.setAttribute('fill', '#ffffff');
    elements.overlay.append(marker);
  }
}

function addPathFromPoints(points) {
  if (!Array.isArray(points) || points.length < 3) {
    setStatus('Polygon draw needs at least 3 points.');
    return;
  }

  const meta = readPathMetaFromForm();
  recordUndoSnapshot('Add path', { pathLabel: meta.netLabel });
  const normalizedPoints = points.map((point) => [
    clamp(point[0], 0, CANVAS_SIZE),
    clamp(point[1], 0, CANVAS_SIZE),
  ]);

  const path = {
    uid: `p-${state.nextUid++}`,
    d: pointsToPath(normalizedPoints, null, true),
    netId: meta.netId,
    netLabel: meta.netLabel,
    category: meta.category,
    color: meta.color,
    strokeWidth: meta.strokeWidth,
    points: normalizedPoints,
    pointModes: Array.from({ length: normalizedPoints.length }, () => 'corner'),
  };

  currentPaths().push(path);
  selectPath(path.uid, { save: false });
  setStatus(`Added ${path.netLabel}.`);
  saveDraft();
}

function commitDrawPath() {
  if (state.drawPoints.length < 3) {
    state.drawPoints = [];
    renderOverlay();
    return;
  }

  const points = state.drawPoints;
  state.drawPoints = [];
  addPathFromPoints(points);
  renderOverlay();
}

function applyMetaToSelected() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }

  recordUndoSnapshot('Update path metadata', { path });
  const meta = readPathMetaFromForm();
  path.netId = meta.netId;
  path.netLabel = meta.netLabel;
  path.category = meta.category;
  path.strokeWidth = meta.strokeWidth;
  applyLayerColorToCurrentSide(meta.color, { save: false, announce: false, recordUndo: false });

  refreshPathList();
  renderOverlay();
  setStatus(`Updated ${path.netLabel}. Layer color applied to current side.`);
  saveDraft();
}

function deleteSelectedPath() {
  if (!state.selectedUid) {
    setStatus('No selected path to delete.');
    return;
  }

  const paths = currentPaths();
  const index = paths.findIndex((entry) => entry.uid === state.selectedUid);
  if (index === -1) return;

  recordUndoSnapshot('Delete path', { path: paths[index] });
  const [removed] = paths.splice(index, 1);
  state.selectedUid = paths.length ? paths[Math.max(0, index - 1)].uid : null;
  state.selectedAnchorIndex = null;

  if (state.selectedUid) assignFormDefaults(activePath());
  refreshPathList();
  renderOverlay();
  setStatus(`Deleted ${removed.netLabel}.`);
  saveDraft();
}

function toggleBezierSelected() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }

  if (!Array.isArray(path.points) || path.points.length < 3 || !Array.isArray(path.pointModes)) {
    setStatus('Selected path does not have editable node modes.');
    return;
  }

  if (!Number.isInteger(state.selectedAnchorIndex)) {
    setStatus('Select an anchor node first, then toggle its curve mode.');
    return;
  }

  if (state.selectedAnchorIndex < 0 || state.selectedAnchorIndex >= path.pointModes.length) {
    setStatus('Selected node is out of range.');
    return;
  }

  const current = path.pointModes[state.selectedAnchorIndex] === 'smooth' ? 'smooth' : 'corner';
  const next = current === 'smooth' ? 'corner' : 'smooth';
  recordUndoSnapshot('Toggle node curve', { path });
  path.pointModes[state.selectedAnchorIndex] = next;
  updatePathGeometry(path);

  refreshPathList();
  renderOverlay();
  setStatus(`Node ${state.selectedAnchorIndex + 1} on ${path.netLabel}: ${next}.`);
  saveDraft();
}

function simplifySelectedPath() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }
  if (!Array.isArray(path.points) || path.points.length < 4) {
    setStatus('Selected path does not have enough editable points to simplify.');
    return;
  }

  const epsilon = clamp(parseFloat(elements.simplifyEpsilon.value) || 3, 0.1, 50);
  const before = path.points.length;
  const simplified = simplifyClosedPolygon(path.points, epsilon);
  if (simplified.length >= before) {
    setStatus(`No points removed (tolerance ${epsilon.toFixed(1)}).`);
    return;
  }

  recordUndoSnapshot('Simplify path', { path });
  path.points = simplified;
  path.pointModes = normalizePointModes(path.pointModes, path.points.length, 'corner');
  state.selectedAnchorIndex = null;
  updatePathGeometry(path);
  refreshPathList();
  renderOverlay();
  setStatus(`Simplified ${path.netLabel}: ${before} -> ${path.points.length} points.`);
  saveDraft();
}

function smoothSelectedPath() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }
  if (!Array.isArray(path.points) || path.points.length < 3) {
    setStatus('Selected path has no editable points to smooth.');
    return;
  }

  const strength = clamp(parseFloat(elements.smoothStrength.value) || 0.25, 0.05, 1);
  recordUndoSnapshot('Smooth path', { path });
  path.points = smoothClosedPolygon(path.points, strength);
  updatePathGeometry(path);
  renderOverlay();
  setStatus(`Smoothed ${path.netLabel} (strength ${strength.toFixed(2)}).`);
  saveDraft();
}

function addNodeFromMenu() {
  const menu = state.nodeMenuState;
  const path = activePath();
  if (!menu || !path || !Array.isArray(path.points) || path.points.length < 2) {
    hideNodeMenu();
    return;
  }

  let insertPoint = menu.point;
  if (!insertPoint && Number.isInteger(menu.anchorIndex)) {
    const i = menu.anchorIndex;
    const next = (i + 1) % path.points.length;
    const a = path.points[i];
    const b = path.points[next];
    insertPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  if (!insertPoint) {
    hideNodeMenu();
    return;
  }

  let segmentIndex;
  if (Number.isInteger(menu.anchorIndex)) {
    segmentIndex = menu.anchorIndex;
  } else {
    segmentIndex = findNearestSegmentIndex(path.points, insertPoint);
  }

  const clamped = [
    clamp(insertPoint[0], 0, CANVAS_SIZE),
    clamp(insertPoint[1], 0, CANVAS_SIZE),
  ];
  recordUndoSnapshot('Add node', { path });
  path.pointModes = normalizePointModes(path.pointModes, path.points.length, 'corner');
  path.points.splice(segmentIndex + 1, 0, clamped);
  path.pointModes.splice(segmentIndex + 1, 0, 'corner');
  state.selectedAnchorIndex = segmentIndex + 1;
  updatePathGeometry(path);
  renderOverlay();
  hideNodeMenu();
  setStatus(`Added node to ${path.netLabel}.`);
  saveDraft();
}

function deleteNodeFromMenu() {
  const menu = state.nodeMenuState;
  const path = activePath();
  if (!menu || !path || !Array.isArray(path.points) || !Number.isInteger(menu.anchorIndex)) {
    hideNodeMenu();
    return;
  }

  if (path.points.length <= 3) {
    hideNodeMenu();
    setStatus('Cannot delete node: a closed path needs at least 3 points.');
    return;
  }

  const index = clamp(menu.anchorIndex, 0, path.points.length - 1);
  recordUndoSnapshot('Delete node', { path });
  path.points.splice(index, 1);
  path.pointModes = normalizePointModes(path.pointModes, path.points.length + 1, 'corner');
  path.pointModes.splice(index, 1);
  if (state.selectedAnchorIndex === index) {
    state.selectedAnchorIndex = null;
  } else if (Number.isInteger(state.selectedAnchorIndex) && state.selectedAnchorIndex > index) {
    state.selectedAnchorIndex -= 1;
  }
  updatePathGeometry(path);
  renderOverlay();
  hideNodeMenu();
  setStatus(`Deleted node from ${path.netLabel}.`);
  saveDraft();
}

function serializeCurrentSideSvg() {
  const body = currentPaths()
    .map((path) => {
      const attrs = [
        `d="${escapeXml(path.d)}"`,
        `data-net-id="${escapeXml(path.netId)}"`,
        `data-net-label="${escapeXml(path.netLabel)}"`,
        `data-category="${escapeXml(path.category)}"`,
        `data-color="${escapeXml(path.color)}"`,
        `fill="${escapeXml(path.color)}"`,
        `fill-opacity="1"`,
      ];

      if (Array.isArray(path.points) && path.points.length >= 3) {
        attrs.push(`data-editor-points="${escapeXml(serializePoints(path.points))}"`);
      }
      if (Array.isArray(path.pointModes) && path.pointModes.length >= 3) {
        attrs.push(`data-editor-point-modes="${escapeXml(serializePointModes(path.pointModes))}"`);
      }

      return `  <path ${attrs.join(' ')} />`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">\n${body}\n</svg>\n`;
}

function exportCurrentSide() {
  const svg = serializeCurrentSideSvg();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.side}-nets.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${state.side}-nets.svg`);
}

function parseSideSvg(side, source) {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const parsed = [];

  doc.querySelectorAll('path[data-net-id]').forEach((node) => {
    const d = node.getAttribute('d');
    if (!d) return;

    const candidate = normalizePath({
      uid: `p-${state.nextUid++}`,
      d,
      netId: node.dataset.netId,
      netLabel: node.dataset.netLabel,
      category: node.dataset.category,
      color: node.dataset.color || node.getAttribute('stroke') || '#ffe05e',
      strokeWidth: node.dataset.strokeWidth || node.getAttribute('stroke-width') || '1',
      curveMode: node.dataset.curveMode,
      editorPoints: node.dataset.editorPoints,
      editorPointModes: node.dataset.editorPointModes,
    });

    if (candidate) parsed.push(candidate);
  });

  state.sides[side].paths = parsed;
  state.sides[side].loaded = true;

  if (side === state.side) ensureSelectedPath();
}

async function loadSideFromFile(side) {
  try {
    const response = await fetch(`./pm/${side}-nets.svg`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    parseSideSvg(side, text);
    resetUndoStack(side);

    if (side === state.side) {
      ensureSelectedPath();
      syncLayerColorFromCurrentSide();
      if (state.selectedUid) assignFormDefaults(activePath());
      refreshPathList();
      renderOverlay();
    }

    setStatus(`Loaded ./pm/${side}-nets.svg`);
    saveDraft();
  } catch (error) {
    state.sides[side].paths = [];
    state.sides[side].loaded = true;
    resetUndoStack(side);

    if (side === state.side) {
      state.selectedUid = null;
      state.selectedAnchorIndex = null;
      syncLayerColorFromCurrentSide();
      refreshPathList();
      renderOverlay();
    }

    setStatus(`Could not load ./pm/${side}-nets.svg (${error.message}). Starting empty.`);
    saveDraft();
  }
}

async function importSideFromUploadedFile(file) {
  if (!file) return;

  const text = await file.text();
  parseSideSvg(state.side, text);
  resetUndoStack(state.side);

  ensureSelectedPath();
  syncLayerColorFromCurrentSide();
  if (state.selectedUid) assignFormDefaults(activePath());
  refreshPathList();
  renderOverlay();
  setStatus(`Imported ${file.name} into ${state.side}.`);
  saveDraft(false);
}

function clientToCanvasPoint(clientX, clientY) {
  const rect = elements.overlay.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  let xNorm = (clientX - rect.left) / rect.width;
  if (elements.mirror.checked) xNorm = 1 - xNorm;

  const yNorm = (clientY - rect.top) / rect.height;
  const x = xNorm * CANVAS_SIZE;
  const y = yNorm * CANVAS_SIZE;

  if (x < 0 || x > CANVAS_SIZE || y < 0 || y > CANVAS_SIZE) return null;
  return [x, y];
}

function zoomAt(clientX, clientY, nextZoom) {
  const rect = elements.viewport.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;

  let worldX = (px - state.panX) / state.zoom;
  if (elements.mirror.checked) worldX = CANVAS_SIZE - worldX;
  const worldY = (py - state.panY) / state.zoom;

  const zoom = clamp(nextZoom, 0.25, 40);
  state.zoom = zoom;

  if (elements.mirror.checked) {
    state.panX = px - state.zoom * (CANVAS_SIZE - worldX);
  } else {
    state.panX = px - worldX * state.zoom;
  }
  state.panY = py - worldY * state.zoom;

  updateSceneTransform();
  renderOverlay();
}

function updateDraggedAnchor(point) {
  if (!state.anchorDrag) return;

  const path = activePath();
  if (!path || path.uid !== state.anchorDrag.uid || !Array.isArray(path.points)) return;

  const index = state.anchorDrag.index;
  if (!Number.isInteger(index) || !path.points[index]) return;
  state.selectedAnchorIndex = index;

  const clampedPoint = [
    clamp(point[0], 0, CANVAS_SIZE),
    clamp(point[1], 0, CANVAS_SIZE),
  ];
  const currentPoint = path.points[index];
  if (pointDistance2(currentPoint, clampedPoint) < 0.0001) return;

  if (!state.anchorDrag.undoRecorded) {
    recordUndoSnapshot('Move node', { path });
    state.anchorDrag.undoRecorded = true;
  }

  path.points[index] = clampedPoint;

  path.d = pointsToPath(path.points, path.pointModes, true);
  renderOverlay();
}

function maybeAppendDrawPoint(point) {
  if (!state.drawing) return;

  const lastPoint = state.drawPoints[state.drawPoints.length - 1] || null;
  const tracePoint = state.tool === 'magnet'
    ? magnetSnapPoint(point, lastPoint)
    : point;

  const last = state.drawPoints[state.drawPoints.length - 1];
  if (!last || pointDistance2(last, tracePoint) >= 9) {
    state.drawPoints.push(tracePoint);
    renderOverlay();
  }
}

function bindEvents() {
  elements.toolButtons.forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });

  [
    elements.netId,
    elements.netLabel,
    elements.category,
    elements.strokeWidth,
    elements.simplifyEpsilon,
    elements.smoothStrength,
    elements.magnetRadius,
    elements.magnetThreshold,
    elements.magnetStrength,
  ].forEach((input) => {
    input.addEventListener('change', () => saveDraft());
    input.addEventListener('input', () => saveDraft());
  });

  elements.color.addEventListener('change', () => {
    applyLayerColorToCurrentSide(elements.color.value, { save: true, announce: true, recordUndo: true });
  });

  elements.debugFillOpacity.addEventListener('input', () => {
    setDebugFillOpacity(elements.debugFillOpacity.value, { save: false, announce: false });
  });

  elements.debugFillOpacity.addEventListener('change', () => {
    setDebugFillOpacity(elements.debugFillOpacity.value, { save: true, announce: false });
  });

  elements.side.addEventListener('change', async (event) => {
    state.side = event.target.value;
    normalizeLayerForSide();
    await loadBaseImage();

    if (!state.sides[state.side].loaded) {
      await loadSideFromFile(state.side);
    }

    ensureSelectedPath();
    syncLayerColorFromCurrentSide();
    if (state.selectedUid) assignFormDefaults(activePath());
    refreshPathList();
    renderOverlay();
    setStatus(`Switched to ${state.side}.`);
    saveDraft();
  });

  elements.layerImage.addEventListener('change', async (event) => {
    state.layerImage = parseInt(event.target.value, 10);
    await loadBaseImage();
    setStatus(`Background changed to ${state.layerImage}.jpg`);
    saveDraft();
  });

  elements.reloadSide.addEventListener('click', async () => {
    await loadSideFromFile(state.side);
  });

  elements.importSide.addEventListener('click', () => {
    elements.importSideFile.click();
  });

  elements.importSideFile.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
      await importSideFromUploadedFile(file);
    } catch (error) {
      console.error(error);
      setStatus(`Could not import SVG (${error.message || error}).`);
    }
  });

  elements.exportSide.addEventListener('click', exportCurrentSide);

  elements.zoomReset.addEventListener('click', () => {
    state.zoom = 1;
    state.panX = 20;
    state.panY = 20;
    updateSceneTransform();
    renderOverlay();
    setStatus('View reset.');
    saveDraft();
  });

  elements.mirror.addEventListener('change', () => {
    updateSceneTransform();
    saveDraft();
  });

  elements.applyMeta.addEventListener('click', applyMetaToSelected);
  elements.deletePath.addEventListener('click', deleteSelectedPath);
  elements.undoEdit.addEventListener('click', () => {
    undoLastEdit({ announce: true });
  });
  elements.toggleBezier.addEventListener('click', toggleBezierSelected);
  elements.simplifyPath.addEventListener('click', simplifySelectedPath);
  elements.smoothPath.addEventListener('click', smoothSelectedPath);
  elements.menuAddNode.addEventListener('click', addNodeFromMenu);
  elements.menuDeleteNode.addEventListener('click', deleteNodeFromMenu);

  elements.pathList.addEventListener('change', () => {
    const uid = elements.pathList.value;
    if (uid) selectPath(uid);
  });

  elements.overlay.addEventListener('contextmenu', (event) => {
    if (state.tool !== 'select') return;

    const path = activePath();
    if (!path || !Array.isArray(path.points) || path.points.length < 3) return;

    const point = clientToCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const anchor = event.target.closest('[data-anchor-index][data-uid]');
    if (anchor && anchor.dataset.uid === path.uid) {
      event.preventDefault();
      const anchorIndex = parseInt(anchor.dataset.anchorIndex, 10);
      if (Number.isInteger(anchorIndex)) {
        state.selectedAnchorIndex = anchorIndex;
        renderOverlay();
        saveDraft();
      }
      showNodeMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        mode: 'anchor',
        anchorIndex: Number.isInteger(anchorIndex) ? anchorIndex : null,
        point,
      });
      return;
    }

    const pathTarget = event.target.closest('.net-path[data-uid], .net-hit[data-uid]');
    if (pathTarget && pathTarget.dataset.uid === path.uid) {
      event.preventDefault();
      showNodeMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        mode: 'path',
        point,
      });
    }
  });

  elements.overlay.addEventListener('click', (event) => {
    if (state.tool !== 'select') return;
    hideNodeMenu();
    if (state.suppressOverlayClick) {
      state.suppressOverlayClick = false;
      return;
    }

    const anchor = event.target.closest('[data-anchor-index][data-uid]');
    if (anchor) {
      if (anchor.dataset.uid !== state.selectedUid) return;
      const anchorIndex = parseInt(anchor.dataset.anchorIndex, 10);
      if (Number.isInteger(anchorIndex)) {
        state.selectedAnchorIndex = anchorIndex;
        renderOverlay();
        saveDraft();
      }
      return;
    }

    const hit = event.target.closest('.net-hit[data-uid]');
    if (hit) {
      state.selectedAnchorIndex = null;
      selectPath(hit.dataset.uid);
      return;
    }

    state.selectedUid = null;
    state.selectedAnchorIndex = null;
    refreshPathList();
    renderOverlay();
    saveDraft();
  });

  elements.overlay.addEventListener('pointerdown', (event) => {
    hideNodeMenu();
    if (event.button !== 0) return;

    const shouldPan = state.tool === 'pan' || state.isSpaceDown;
    if (shouldPan) return;

    const anchorTarget = event.target.closest('[data-anchor-index][data-uid]');
    if (anchorTarget && state.tool === 'select') {
      const uid = anchorTarget.dataset.uid;
      const index = parseInt(anchorTarget.dataset.anchorIndex, 10);
      const path = activePath();

      if (path && path.uid === uid && Number.isInteger(index)) {
        state.selectedAnchorIndex = index;
        state.anchorDrag = {
          uid,
          index,
          pointerId: event.pointerId,
          undoRecorded: false,
        };

        elements.overlay.setPointerCapture(event.pointerId);
        renderOverlay();
        saveDraft();
        event.preventDefault();
      }
      return;
    }

    if (state.tool === 'polygon' || state.tool === 'magnet') {
      const point = clientToCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const firstPoint = state.tool === 'magnet' ? magnetSnapPoint(point, null) : point;

      state.drawPoints = [firstPoint];
      state.drawing = {
        pointerId: event.pointerId,
      };

      elements.overlay.setPointerCapture(event.pointerId);
      renderOverlay();
      event.preventDefault();
    }
  });

  elements.overlay.addEventListener('pointermove', (event) => {
    if (state.anchorDrag && state.anchorDrag.pointerId === event.pointerId) {
      const point = clientToCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      updateDraggedAnchor(point);
      return;
    }

    if (state.drawing && state.drawing.pointerId === event.pointerId) {
      const point = clientToCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      maybeAppendDrawPoint(point);
    }
  });

  const finishPointerSession = (event) => {
    if (state.anchorDrag && state.anchorDrag.pointerId === event.pointerId) {
      elements.overlay.releasePointerCapture(event.pointerId);
      state.anchorDrag = null;
      state.suppressOverlayClick = true;
      saveDraft();
      return;
    }

    if (state.drawing && state.drawing.pointerId === event.pointerId) {
      const point = clientToCanvasPoint(event.clientX, event.clientY);
      if (point) maybeAppendDrawPoint(point);

      elements.overlay.releasePointerCapture(event.pointerId);
      state.drawing = null;
      commitDrawPath();
    }
  };

  elements.overlay.addEventListener('pointerup', finishPointerSession);
  elements.overlay.addEventListener('pointercancel', finishPointerSession);

  elements.viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const scaleStep = Math.exp(-event.deltaY * 0.0016);
      zoomAt(event.clientX, event.clientY, state.zoom * scaleStep);
      saveDraft();
    },
    { passive: false }
  );

  elements.viewport.addEventListener('pointerdown', (event) => {
    hideNodeMenu();
    const shouldPan = state.tool === 'pan' || state.isSpaceDown || event.button === 1;
    if (!shouldPan) return;

    state.panning = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.panX,
      originY: state.panY,
    };

    elements.viewport.setPointerCapture(event.pointerId);
  });

  elements.viewport.addEventListener('pointermove', (event) => {
    if (!state.panning || state.panning.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.panning.startX;
    const dy = event.clientY - state.panning.startY;
    state.panX = state.panning.originX + dx;
    state.panY = state.panning.originY + dy;

    updateSceneTransform();
  });

  elements.viewport.addEventListener('pointerup', (event) => {
    if (!state.panning || state.panning.pointerId !== event.pointerId) return;
    state.panning = null;
    elements.viewport.releasePointerCapture(event.pointerId);
    saveDraft();
  });

  document.addEventListener('keydown', (event) => {
    if (editableTarget(event.target)) return;

    const key = event.key.toLowerCase();
    const wantsUndo = key === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
    if (wantsUndo) {
      event.preventDefault();
      undoLastEdit({ announce: true });
      return;
    }

    if (key === ' ') {
      state.isSpaceDown = true;
      return;
    }

    if (key === 'v') setTool('select');
    if (key === 'p') setTool('polygon');
    if (key === 'm') setTool('magnet');
    if (key === 'h') setTool('pan');
    if (key === 'b') toggleBezierSelected();
    if ((key === '[' || key === ']') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      selectAdjacentPath(key === ']' ? 1 : -1);
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      const active = document.activeElement;
      if (!editableTarget(active)) {
        event.preventDefault();
        deleteSelectedPath();
      }
    }

    if (
      key === 'enter' &&
      (state.tool === 'polygon' || state.tool === 'magnet') &&
      state.drawPoints.length > 0
    ) {
      event.preventDefault();
      state.drawing = null;
      commitDrawPath();
    }

    if (key === 'escape') {
      if (!elements.nodeMenu.hidden) {
        hideNodeMenu();
      }
      state.drawPoints = [];
      state.drawing = null;
      state.anchorDrag = null;
      renderOverlay();
      setStatus('Cancelled current draft action.');
    }

    if ((key === '+' || key === '=') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, state.zoom * 1.15);
      saveDraft();
    }

    if (key === '-' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, state.zoom / 1.15);
      saveDraft();
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === ' ') {
      state.isSpaceDown = false;
      return;
    }
    if (editableTarget(event.target)) return;
  });

  document.addEventListener('pointerdown', (event) => {
    if (elements.nodeMenu.hidden) return;
    if (event.target.closest('#node-menu')) return;
    hideNodeMenu();
  });
}

async function init() {
  bindEvents();

  const restored = restoreDraft();
  normalizeLayerForSide();
  updateSceneTransform();
  await loadBaseImage();

  if (!restored) {
    await Promise.all([loadSideFromFile('front'), loadSideFromFile('back')]);
  }

  ensureSelectedPath();
  syncLayerColorFromCurrentSide();
  setDebugFillOpacity(state.debugFillOpacity, { save: false, announce: false });
  if (state.selectedUid) assignFormDefaults(activePath());

  refreshPathList();
  setTool(state.tool, { save: false, announce: false });
  renderOverlay();

  setStatus(
    restored
      ? 'Editor ready. Restored draft from local storage.'
      : 'Editor ready. Drag in Polygon or Magnet mode to draw a new closed net shape.'
  );
}

init();
