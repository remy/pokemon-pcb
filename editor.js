const SVG_NS = 'http://www.w3.org/2000/svg';
const CANVAS_SIZE = 1765;
const STORAGE_KEY = 'pcb-xray-net-editor-v2';
const MAX_UNDO_ENTRIES = 100;
const LINE_VIA_RADIUS = 5;
const ANCHOR_HIT_RADIUS_PX = 9;
const ANCHOR_MARKER_RADIUS_PX = 2.3;
const ANCHOR_MARKER_SELECTED_RADIUS_PX = 3.2;

const elements = {
  side: document.querySelector('#side'),
  layerImage: document.querySelector('#layer-image'),
  newProject: document.querySelector('#new-project'),
  importSide: document.querySelector('#import-side'),
  importSideFile: document.querySelector('#import-side-file'),
  exportSide: document.querySelector('#export-side'),
  openGroups: document.querySelector('#open-groups'),
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
  color: document.querySelector('#net-color'),
  debugFillOpacity: document.querySelector('#debug-fill-opacity'),
  debugFillOpacityReadout: document.querySelector('#debug-fill-opacity-readout'),
  strokeWidth: document.querySelector('#stroke-width'),
  applyMeta: document.querySelector('#apply-meta'),
  deletePath: document.querySelector('#delete-path'),
  mergePaths: document.querySelector('#merge-paths'),
  undoEdit: document.querySelector('#undo-edit'),
  toggleBezier: document.querySelector('#toggle-bezier'),
  resetPathCurves: document.querySelector('#reset-path-curves'),
  simplifyEpsilon: document.querySelector('#simplify-epsilon'),
  smoothStrength: document.querySelector('#smooth-strength'),
  simplifyPath: document.querySelector('#simplify-path'),
  smoothPath: document.querySelector('#smooth-path'),
  magnetRadius: document.querySelector('#magnet-radius'),
  magnetThreshold: document.querySelector('#magnet-threshold'),
  magnetStrength: document.querySelector('#magnet-strength'),
  pathList: document.querySelector('#path-list'),
  toolsHelpToggle: document.querySelector('#tools-help-toggle'),
  pathsHelpToggle: document.querySelector('#paths-help-toggle'),
  toolsHelp: document.querySelector('#tools-help'),
  pathsHelp: document.querySelector('#paths-help'),
  nodeMenu: document.querySelector('#node-menu'),
  nodeMenuTitle: document.querySelector('#node-menu-title'),
  menuAddNode: document.querySelector('#menu-add-node'),
  menuDeleteNode: document.querySelector('#menu-delete-node'),
  status: document.querySelector('#status'),
  groupsModal: document.querySelector('#groups-modal'),
  groupsClose: document.querySelector('#groups-close'),
  groupsList: document.querySelector('#groups-list'),
  groupCreate: document.querySelector('#group-create'),
  groupDelete: document.querySelector('#group-delete'),
  groupSave: document.querySelector('#group-save'),
  groupName: document.querySelector('#group-name'),
  groupOrder: document.querySelector('#group-order'),
  groupDefaultOn: document.querySelector('#group-default-on'),
  groupNetAvailable: document.querySelector('#group-net-available'),
  groupNetMembers: document.querySelector('#group-net-members'),
  groupAddNet: document.querySelector('#group-add-net'),
  groupRemoveNet: document.querySelector('#group-remove-net'),
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
  lastPointerPoint: null,
  suppressOverlayClick: false,
  nodeMenuState: null,
  selectedUid: null,
  selectedUids: [],
  selectedGroupId: null,
  selectedAnchorIndex: null,
  selectedHoleIndex: null,
  drawPoints: [],
  drawVias: [],
  nextUid: 1,
  nextGroupUid: 1,
  groups: [],
  helpPanels: {
    tools: false,
    paths: false,
  },
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
  mergeRaster: {
    canvas: document.createElement('canvas'),
    ctx: null,
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
state.mergeRaster.canvas.width = CANVAS_SIZE;
state.mergeRaster.canvas.height = CANVAS_SIZE;
state.mergeRaster.ctx = state.mergeRaster.canvas.getContext('2d', { willReadFrequently: true });

function setStatus(text) {
  elements.status.textContent = text;
}

function normalizeHelpPanelState(raw) {
  return {
    tools: raw?.tools === true,
    paths: raw?.paths === true,
  };
}

function applyHelpPanels() {
  const toolsVisible = state.helpPanels.tools === true;
  const pathsVisible = state.helpPanels.paths === true;

  if (elements.toolsHelp) elements.toolsHelp.hidden = !toolsVisible;
  if (elements.pathsHelp) elements.pathsHelp.hidden = !pathsVisible;
  if (elements.toolsHelpToggle) elements.toolsHelpToggle.setAttribute('aria-pressed', toolsVisible ? 'true' : 'false');
  if (elements.pathsHelpToggle) elements.pathsHelpToggle.setAttribute('aria-pressed', pathsVisible ? 'true' : 'false');
}

function toggleHelpPanel(panel) {
  if (panel !== 'tools' && panel !== 'paths') return;
  state.helpPanels[panel] = !state.helpPanels[panel];
  applyHelpPanels();
  saveDraft();
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

function pathListTarget(target) {
  if (!(target instanceof HTMLElement) || !elements.pathList) return false;
  return target === elements.pathList || target.closest('#path-list') === elements.pathList;
}

function stripSidePrefix(netId) {
  const raw = String(netId || '').trim();
  if (!raw.length) return '';
  return raw.replace(/^(front|back)-/i, '');
}

function normalizeNetKey(netId) {
  return stripSidePrefix(netId).trim();
}

function withSidePrefix(netId, side = state.side) {
  const base = normalizeNetKey(netId);
  if (!base.length) return '';
  const targetSide = side === 'back' ? 'back' : 'front';
  return `${targetSide}-${base}`;
}

function categoryFromNetId(netId) {
  const key = normalizeNetKey(netId);
  return key || 'uncategorized';
}

function currentNetColor() {
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

function hasActivePointerInteraction() {
  return !!(state.panning || state.drawing || state.anchorDrag);
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
  return parsePointsWithMin(value, 3);
}

function parsePointsWithMin(value, minPoints = 3) {
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

  if (parsed.length < minPoints) return null;
  return parsed;
}

function parseVias(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [xRaw, yRaw, rRaw] = chunk.split(',').map((token) => parseFloat(token));
      if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
      const x = clamp(xRaw, 0, CANVAS_SIZE);
      const y = clamp(yRaw, 0, CANVAS_SIZE);
      const radius = clamp(Number.isFinite(rRaw) ? rRaw : LINE_VIA_RADIUS, 0.5, 80);
      return [x, y, radius];
    })
    .filter(Boolean);
}

function serializeVias(vias) {
  if (!Array.isArray(vias) || !vias.length) return '';
  return vias
    .map((via) => {
      const x = Number(via[0]);
      const y = Number(via[1]);
      const r = Number(via[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const radius = Number.isFinite(r) ? r : LINE_VIA_RADIUS;
      return `${x.toFixed(2)},${y.toFixed(2)},${radius.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(';');
}

function normalizeHole(rawHole) {
  const pointsRaw = Array.isArray(rawHole?.points)
    ? rawHole.points
    : Array.isArray(rawHole)
      ? rawHole
      : null;
  if (!pointsRaw) return null;

  const points = pointsRaw
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const x = parseFloat(pair[0]);
      const y = parseFloat(pair[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [clamp(x, 0, CANVAS_SIZE), clamp(y, 0, CANVAS_SIZE)];
    })
    .filter(Boolean);
  if (points.length < 3) return null;

  const pointModes = normalizePointModes(rawHole?.pointModes, points.length, 'corner');
  return { points, pointModes };
}

function parseHoles(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const decoded = JSON.parse(value);
    if (!Array.isArray(decoded)) return [];
    return decoded.map(normalizeHole).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeHoles(holes) {
  if (!Array.isArray(holes) || !holes.length) return '';
  const normalized = holes
    .map(normalizeHole)
    .filter(Boolean)
    .map((hole) => ({
      points: hole.points.map((pair) => [Number(pair[0].toFixed(2)), Number(pair[1].toFixed(2))]),
      pointModes: normalizePointModes(hole.pointModes, hole.points.length, 'corner'),
    }));
  if (!normalized.length) return '';
  return JSON.stringify(normalized);
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

function extractPointsFromSimplePath(d, minPoints = 3) {
  if (!d) return null;
  if (/[CQSTAHV]/i.test(d)) return null;

  const numbers = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  const required = Math.max(2, Number.isFinite(minPoints) ? Math.floor(minPoints) : 3);
  if (numbers.length < required * 2 || numbers.length % 2 !== 0) return null;

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

  return points.length >= required ? points : null;
}

function contourArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area * 0.5);
}

function extractEditableContourFromPathD(d, minPoints = 3) {
  if (!d) return null;
  const subpaths = (String(d).match(/[Mm][^Mm]*/g) || []).map((segment) => segment.trim()).filter(Boolean);
  const candidates = subpaths.length ? subpaths : [String(d).trim()];
  const required = Math.max(3, Number.isFinite(minPoints) ? Math.floor(minPoints) : 3);
  let best = null;
  let bestScore = 0;

  candidates.forEach((segment) => {
    let points = extractPointsFromSimplePath(segment, required);
    if (!points) {
      const sampled = samplePathPolyline(segment, 2.2);
      if (sampled.length >= required) {
        points = simplifyClosedPolygon(sampled, 1.1);
      }
    }
    if (!Array.isArray(points) || points.length < required) return;

    let normalized = dedupeSequentialPoints(points, 0.4).map((point) => [point[0], point[1]]);
    if (normalized.length > 2 && pointDistance2(normalized[0], normalized[normalized.length - 1]) < 1) {
      normalized = normalized.slice(0, -1);
    }
    if (normalized.length < required) return;

    const score = contourArea(normalized);
    if (score > bestScore) {
      bestScore = score;
      best = normalized;
    }
  });

  return best;
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

function smoothOpenPolyline(points, strength) {
  if (!Array.isArray(points) || points.length < 3) {
    return points ? points.map((point) => [...point]) : [];
  }

  const alpha = clamp(strength, 0.01, 1);
  const n = points.length;
  const output = [points[0].map((value) => value)];

  for (let i = 1; i < n - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];

    const avgX = (prev[0] + next[0]) / 2;
    const avgY = (prev[1] + next[1]) / 2;

    output.push([
      cur[0] * (1 - alpha) + avgX * alpha,
      cur[1] * (1 - alpha) + avgY * alpha,
    ]);
  }

  output.push(points[n - 1].map((value) => value));
  return output;
}

function signedContourArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function polygonCentroid(points) {
  if (!Array.isArray(points) || !points.length) return [0, 0];
  let sumX = 0;
  let sumY = 0;
  points.forEach((point) => {
    sumX += point[0];
    sumY += point[1];
  });
  return [sumX / points.length, sumY / points.length];
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(point) || point.length < 2 || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = point[0];
  const y = point[1];
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function contourModeSamples(points, pointModes) {
  if (!Array.isArray(points) || points.length < 1) return [];
  const modes = normalizePointModes(pointModes, points.length, 'corner');
  const samples = [];
  points.forEach((point, index) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    samples.push({
      x,
      y,
      mode: modes[index] === 'smooth' ? 'smooth' : 'corner',
    });
  });
  return samples;
}

function collectModeSamplesFromPaths(paths) {
  if (!Array.isArray(paths) || !paths.length) return [];
  const samples = [];
  paths.forEach((path) => {
    if (!path || !Array.isArray(path.points)) return;
    samples.push(...contourModeSamples(path.points, path.pointModes));
    if (!Array.isArray(path.holes)) return;
    path.holes.forEach((rawHole) => {
      const hole = normalizeHole(rawHole);
      if (!hole) return;
      samples.push(...contourModeSamples(hole.points, hole.pointModes));
    });
  });
  return samples;
}

function inferPointModesFromSamples(points, samples) {
  if (!Array.isArray(points) || !points.length) return [];
  if (!Array.isArray(samples) || !samples.length) {
    return Array.from({ length: points.length }, () => 'corner');
  }

  return points.map((point) => {
    if (!Array.isArray(point) || point.length < 2) return 'corner';
    let nearestSmoothDistance2 = Number.POSITIVE_INFINITY;
    let nearestCornerDistance2 = Number.POSITIVE_INFINITY;

    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      const dx = point[0] - sample.x;
      const dy = point[1] - sample.y;
      const distance2 = dx * dx + dy * dy;
      if (sample.mode === 'smooth') {
        if (distance2 < nearestSmoothDistance2) nearestSmoothDistance2 = distance2;
      } else if (distance2 < nearestCornerDistance2) {
        nearestCornerDistance2 = distance2;
      }
    }

    if (!Number.isFinite(nearestCornerDistance2)) {
      return Number.isFinite(nearestSmoothDistance2) ? 'smooth' : 'corner';
    }
    if (!Number.isFinite(nearestSmoothDistance2)) return 'corner';
    return nearestSmoothDistance2 * 0.9 < nearestCornerDistance2 ? 'smooth' : 'corner';
  });
}

function buildMaskLoopsFromAlpha(alpha, width, height, options = {}) {
  if (!alpha || !width || !height) return [];
  const simplifyEpsilon = clamp(parseFloat(options.simplifyEpsilon) || 0.85, 0.25, 8);
  const minArea = clamp(parseFloat(options.minArea) || 10, 1, 5000);
  const edgeSegments = [];
  const segmentKey = (x, y) => `${x},${y}`;
  const isFilled = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return alpha[y * width + x] > 0;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isFilled(x, y)) continue;

      if (!isFilled(x, y - 1)) edgeSegments.push([x, y, x + 1, y]);
      if (!isFilled(x + 1, y)) edgeSegments.push([x + 1, y, x + 1, y + 1]);
      if (!isFilled(x, y + 1)) edgeSegments.push([x + 1, y + 1, x, y + 1]);
      if (!isFilled(x - 1, y)) edgeSegments.push([x, y + 1, x, y]);
    }
  }

  if (!edgeSegments.length) return [];

  const outgoing = new Map();
  edgeSegments.forEach((segment, index) => {
    const key = segmentKey(segment[0], segment[1]);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(index);
  });

  const visited = new Uint8Array(edgeSegments.length);
  const loops = [];

  for (let i = 0; i < edgeSegments.length; i += 1) {
    if (visited[i]) continue;

    const startSegment = edgeSegments[i];
    const startKey = segmentKey(startSegment[0], startSegment[1]);
    let segmentIndex = i;
    let guard = 0;
    const loop = [];

    while (!visited[segmentIndex] && guard < edgeSegments.length + 8) {
      guard += 1;
      visited[segmentIndex] = 1;
      const segment = edgeSegments[segmentIndex];
      loop.push([segment[0], segment[1]]);

      const nextKey = segmentKey(segment[2], segment[3]);
      if (nextKey === startKey) break;

      const candidates = outgoing.get(nextKey) || [];
      let nextIndex = -1;
      for (let c = 0; c < candidates.length; c += 1) {
        const candidate = candidates[c];
        if (!visited[candidate]) {
          nextIndex = candidate;
          break;
        }
      }
      if (nextIndex < 0) break;
      segmentIndex = nextIndex;
    }

    if (loop.length < 3) continue;
    let normalized = dedupeSequentialPoints(loop, 0.4).map((point) => [point[0], point[1]]);
    if (normalized.length > 2 && pointDistance2(normalized[0], normalized[normalized.length - 1]) < 1) {
      normalized = normalized.slice(0, -1);
    }
    if (normalized.length < 3) continue;

    const simplified = simplifyClosedPolygon(normalized, simplifyEpsilon);
    if (simplified.length < 3) continue;
    if (contourArea(simplified) < minArea) continue;
    loops.push(simplified);
  }

  return loops;
}

function buildMergedGeometryFromSelection(selectedPaths) {
  if (!Array.isArray(selectedPaths) || !selectedPaths.length || !state.mergeRaster.ctx) return null;
  const ctx = state.mergeRaster.ctx;
  const { width, height } = state.mergeRaster;
  const sourceModeSamples = collectModeSamplesFromPaths(selectedPaths);
  const smoothSampleCount = sourceModeSamples.filter((sample) => sample.mode === 'smooth').length;
  const cornerSampleCount = Math.max(0, sourceModeSamples.length - smoothSampleCount);
  const curveHeavy = smoothSampleCount > cornerSampleCount;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';

  let drewAny = false;
  selectedPaths.forEach((path) => {
    const d = pathDForMerge(path);
    if (!d) return;
    let shape = null;
    try {
      shape = new Path2D(d);
    } catch {
      shape = null;
    }
    if (!shape) return;
    const fillRule = normalizeFillRule(path.fillRule, path.pathKind) === 'evenodd' ? 'evenodd' : 'nonzero';
    ctx.fill(shape, fillRule);
    drewAny = true;
  });
  ctx.restore();

  if (!drewAny) return null;

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0, p = 3; i < alpha.length; i += 1, p += 4) {
    alpha[i] = rgba[p] > 0 ? 1 : 0;
  }

  const loops = buildMaskLoopsFromAlpha(alpha, width, height, {
    simplifyEpsilon: curveHeavy ? 2.2 : 1.1,
    minArea: 10,
  });
  if (!loops.length) return null;
  loops.sort((a, b) => contourArea(b) - contourArea(a));

  const outer = loops[0];
  if (!Array.isArray(outer) || outer.length < 3) return null;

  const holes = [];
  loops.slice(1).forEach((loop) => {
    const center = polygonCentroid(loop);
    if (pointInPolygon(center, outer)) {
      holes.push(loop);
    }
  });

  const outerOriented = signedContourArea(outer) < 0 ? outer.slice() : outer.slice().reverse();
  const holeContours = holes.map((hole) => (signedContourArea(hole) > 0 ? hole.slice() : hole.slice().reverse()));
  const outerPointModes = inferPointModesFromSamples(outerOriented, sourceModeSamples);
  const holePointModes = holeContours.map((hole) => inferPointModesFromSamples(hole, sourceModeSamples));
  const pathSegments = [pointsToPath(outerOriented, outerPointModes, true)]
    .concat(holeContours.map((hole, holeIndex) => pointsToPath(hole, holePointModes[holeIndex], true)))
    .filter(Boolean);
  if (!pathSegments.length) return null;

  return {
    d: pathSegments.join(' '),
    fillRule: 'evenodd',
    points: outerOriented.map((point) => [point[0], point[1]]),
    pointModes: outerPointModes,
    holes: holeContours.map((hole, holeIndex) => ({
      points: hole.map((point) => [point[0], point[1]]),
      pointModes: holePointModes[holeIndex] || Array.from({ length: hole.length }, () => 'corner'),
    })),
    loopCount: loops.length,
  };
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
  // Do not infer "all smooth" from cubic commands alone.
  // Paths can contain C segments without reliable per-node mode metadata.
  return 'corner';
}

function modeStats(pointModes) {
  if (!Array.isArray(pointModes)) return { total: 0, smooth: 0, corner: 0 };
  const total = pointModes.length;
  let smooth = 0;
  pointModes.forEach((mode) => {
    if (mode === 'smooth') smooth += 1;
  });
  return { total, smooth, corner: total - smooth };
}

function normalizeSelectedHoleIndex(path, holeIndex) {
  if (!path || !Array.isArray(path.holes)) return null;
  if (!Number.isInteger(holeIndex)) return null;
  if (holeIndex < 0 || holeIndex >= path.holes.length) return null;
  const hole = normalizeHole(path.holes[holeIndex]);
  if (!hole) return null;
  path.holes[holeIndex] = hole;
  return holeIndex;
}

function getContourData(path, holeIndex = null) {
  const normalizedHoleIndex = normalizeSelectedHoleIndex(path, holeIndex);
  if (Number.isInteger(normalizedHoleIndex)) {
    const hole = path.holes[normalizedHoleIndex];
    return {
      points: hole.points,
      pointModes: hole.pointModes,
      holeIndex: normalizedHoleIndex,
      isHole: true,
    };
  }
  return {
    points: path?.points || [],
    pointModes: path?.pointModes || [],
    holeIndex: null,
    isHole: false,
  };
}

function contourName(path, holeIndex = null) {
  if (!path) return 'path';
  if (Number.isInteger(normalizeSelectedHoleIndex(path, holeIndex))) {
    return `${path.netLabel} hole ${holeIndex + 1}`;
  }
  return path.netLabel;
}

function setAllPathModes(path, mode = 'corner') {
  if (!path || !Array.isArray(path.points) || !path.points.length) return false;
  const targetMode = mode === 'smooth' ? 'smooth' : 'corner';
  const nextModes = Array.from({ length: path.points.length }, () => targetMode);
  const currentModes = normalizePointModes(path.pointModes, path.points.length, 'corner');
  const changed = currentModes.some((entry, index) => entry !== nextModes[index]);
  path.pointModes = nextModes;
  updatePathGeometry(path);
  return changed;
}

function normalizePathKind(value) {
  return value === 'line' ? 'line' : 'area';
}

function normalizeFillRule(value, pathKind = 'area') {
  if (normalizePathKind(pathKind) === 'line') return 'nonzero';
  return String(value || '').trim().toLowerCase() === 'nonzero' ? 'nonzero' : 'evenodd';
}

function viaCirclesToPath(vias) {
  if (!Array.isArray(vias) || !vias.length) return '';
  const commands = [];
  vias.forEach((via) => {
    if (!Array.isArray(via) || via.length < 2) return;
    const x = clamp(parseFloat(via[0]), 0, CANVAS_SIZE);
    const y = clamp(parseFloat(via[1]), 0, CANVAS_SIZE);
    const r = clamp(parseFloat(via[2]) || LINE_VIA_RADIUS, 0.5, 80);
    commands.push(
      `M ${(x - r).toFixed(2)} ${y.toFixed(2)}`,
      `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0`,
      `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`
    );
  });
  return commands.join(' ');
}

function dedupeSequentialPoints(points, minDistance = 0.25) {
  if (!Array.isArray(points) || !points.length) return [];
  const out = [points[0]];
  const minDistance2 = minDistance * minDistance;

  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1];
    const next = points[i];
    if (pointDistance2(prev, next) > minDistance2) {
      out.push(next);
    }
  }

  if (out.length > 2 && pointDistance2(out[0], out[out.length - 1]) < minDistance2) {
    out.pop();
  }

  return out;
}

function samplePathPolyline(d, step = 1.5) {
  if (!d) return [];
  const probe = document.createElementNS(SVG_NS, 'path');
  probe.setAttribute('d', d);

  let total = 0;
  try {
    total = probe.getTotalLength();
  } catch (error) {
    return [];
  }

  if (!Number.isFinite(total) || total <= 0) return [];
  const stepSize = clamp(step, 0.5, 8);
  const segments = Math.max(2, Math.ceil(total / stepSize));
  const sampled = [];

  for (let i = 0; i <= segments; i += 1) {
    const p = probe.getPointAtLength((total * i) / segments);
    sampled.push([clamp(p.x, 0, CANVAS_SIZE), clamp(p.y, 0, CANVAS_SIZE)]);
  }

  return dedupeSequentialPoints(sampled, stepSize * 0.2);
}

function normalizeVector(dx, dy, fallback = [1, 0]) {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length < 1e-6) {
    return fallback;
  }
  return [dx / length, dy / length];
}

function openPolylineToRibbon(points, halfWidth) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const n = points.length;
  const half = Math.max(0.25, Number(halfWidth) || 0.5);
  const left = [];
  const right = [];

  for (let i = 0; i < n; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const cur = points[i];
    const next = points[Math.min(n - 1, i + 1)];
    const [tx, ty] = normalizeVector(next[0] - prev[0], next[1] - prev[1], [1, 0]);
    const nx = -ty;
    const ny = tx;

    left.push([
      clamp(cur[0] + nx * half, 0, CANVAS_SIZE),
      clamp(cur[1] + ny * half, 0, CANVAS_SIZE),
    ]);
    right.push([
      clamp(cur[0] - nx * half, 0, CANVAS_SIZE),
      clamp(cur[1] - ny * half, 0, CANVAS_SIZE),
    ]);
  }

  return [...left, ...right.reverse()];
}

function buildLineExportPathD(path) {
  const halfWidth = Math.max(0.5, (parseFloat(path.strokeWidth) || 1) / 2);
  const sampleStep = Math.max(0.8, halfWidth * 0.7);
  let source = [];

  if (path && Array.isArray(path.points) && path.points.length >= 2) {
    const centerline = pointsToPath(path.points, path.pointModes, false);
    if (centerline) {
      source = samplePathPolyline(centerline, sampleStep);
      if (source.length < 2) {
        source = path.points.map((point) => [point[0], point[1]]);
      }
    }
  }

  if (source.length < 2 && path && typeof path.d === 'string' && path.d.trim().length) {
    source = samplePathPolyline(path.d, sampleStep);
  }

  if (source.length < 2) return String(path?.d || '').trim();
  const ring = openPolylineToRibbon(source, halfWidth);
  const ribbon = pointsToPath(ring, null, true);
  if (!ribbon) return String(path?.d || '').trim();

  const viasPath = viaCirclesToPath(path.vias);
  return viasPath ? `${ribbon} ${viasPath}` : ribbon;
}

function buildPathD(path) {
  if (!path || !Array.isArray(path.points)) return '';
  const isLine = normalizePathKind(path.pathKind) === 'line';
  const base = pointsToPath(path.points, path.pointModes, !isLine);
  if (!base) return '';
  if (!isLine) {
    const holeSegments = Array.isArray(path.holes)
      ? path.holes
          .map((hole) => normalizeHole(hole))
          .filter(Boolean)
          .map((hole) => pointsToPath(hole.points, hole.pointModes, true))
          .filter(Boolean)
      : [];
    return holeSegments.length ? `${base} ${holeSegments.join(' ')}` : base;
  }
  const viasPath = viaCirclesToPath(path.vias);
  return viasPath ? `${base} ${viasPath}` : base;
}

function normalizePath(raw) {
  const d = String(raw?.d || '').trim();
  const netId = String(raw?.netId || '').trim() || `net-${Date.now()}`;
  const netLabel = String(raw?.netLabel || '').trim() || netId;
  const category = String(raw?.category || categoryFromNetId(netId)).trim() || categoryFromNetId(netId);
  const color = String(raw?.color || '#ffe05e').trim() || '#ffe05e';
  const strokeWidth = clamp(parseFloat(raw?.strokeWidth) || 1, 0.1, 20);
  const pathKind = normalizePathKind(raw?.pathKind || raw?.editorKind);
  const fillRule = normalizeFillRule(raw?.fillRule || raw?.editorFillRule, pathKind);
  const holes = Array.isArray(raw?.holes)
    ? raw.holes.map(normalizeHole).filter(Boolean)
    : parseHoles(raw?.editorHoles || '');
  const vias = Array.isArray(raw?.vias)
    ? raw.vias
        .map((via) => {
          if (!Array.isArray(via) || via.length < 2) return null;
          const x = parseFloat(via[0]);
          const y = parseFloat(via[1]);
          const r = parseFloat(via[2]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return [clamp(x, 0, CANVAS_SIZE), clamp(y, 0, CANVAS_SIZE), clamp(Number.isFinite(r) ? r : LINE_VIA_RADIUS, 0.5, 80)];
        })
        .filter(Boolean)
    : parseVias(raw?.editorVias || '');

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

    if (points.length < (pathKind === 'line' ? 2 : 3)) points = null;
  }

  if (!points) points = parsePointsWithMin(raw?.editorPoints || '', pathKind === 'line' ? 2 : 3);
  if (!points) points = extractPointsFromSimplePath(d, pathKind === 'line' ? 2 : 3);

  let parsedPointModes = null;
  let pointModesFromArray = false;
  if (Array.isArray(raw?.pointModes)) {
    pointModesFromArray = true;
    const expected = points ? points.length : raw.pointModes.length;
    parsedPointModes = normalizePointModes(raw.pointModes, expected, 'corner');
  } else {
    parsedPointModes = parsePointModes(
      raw?.editorPointModes || raw?.pointModes || '',
      points ? points.length : undefined
    );
  }
  const editorModeVersion = String(raw?.editorModeVersion || '').trim();
  const draftVersion = parseInt(raw?.draftVersion, 10);
  const isLegacyDraft = Number.isFinite(draftVersion) && draftVersion <= 2;
  const isAllSmoothModes =
    Array.isArray(parsedPointModes) &&
    points &&
    parsedPointModes.length === points.length &&
    parsedPointModes.length > 0 &&
    parsedPointModes.every((mode) => mode === 'smooth');
  const hasLegacyAllSmoothModes =
    (pointModesFromArray && isLegacyDraft && isAllSmoothModes) ||
    (!pointModesFromArray && editorModeVersion !== '2' && isAllSmoothModes);
  if (hasLegacyAllSmoothModes) {
    parsedPointModes = Array.from({ length: points.length }, () => 'corner');
  }
  const fallbackMode = inferFallbackModeFromPath(d, raw?.curveMode);
  const pointModes = points
    ? normalizePointModes(parsedPointModes, points.length, fallbackMode)
    : [];

  let finalD = d;
  if ((!finalD || !finalD.length) && points) {
    finalD = buildPathD({ points, pointModes, pathKind, vias, holes });
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
    pathKind,
    fillRule,
    holes,
    vias,
    points,
    pointModes,
  };
}

function cloneSerializablePath(path) {
  const netId = String(path.netId || '');
  return {
    uid: String(path.uid || ''),
    d: String(path.d || ''),
    netId,
    netLabel: String(path.netLabel || ''),
    category: String(path.category || categoryFromNetId(netId)),
    color: String(path.color || '#ffe05e'),
    strokeWidth: clamp(parseFloat(path.strokeWidth) || 1, 0.1, 20),
    pathKind: normalizePathKind(path.pathKind),
    fillRule: normalizeFillRule(path.fillRule, path.pathKind),
    holes: Array.isArray(path.holes)
      ? path.holes
          .map(normalizeHole)
          .filter(Boolean)
          .map((hole) => ({
            points: hole.points.map((point) => [Number(point[0]), Number(point[1])]),
            pointModes: normalizePointModes(hole.pointModes, hole.points.length, 'corner'),
          }))
      : [],
    vias: Array.isArray(path.vias)
      ? path.vias
          .map((via) => {
            if (!Array.isArray(via) || via.length < 2) return null;
            const x = Number(via[0]);
            const y = Number(via[1]);
            const r = Number(via[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return [x, y, Number.isFinite(r) ? r : LINE_VIA_RADIUS];
          })
          .filter(Boolean)
      : [],
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
    selectedUids: selectedPathUids(),
    selectedAnchorIndex: Number.isInteger(state.selectedAnchorIndex) ? state.selectedAnchorIndex : null,
    selectedHoleIndex: Number.isInteger(state.selectedHoleIndex) ? state.selectedHoleIndex : null,
    nextUid: state.nextUid,
    layerColor: hasLayerColor ? details.layerColor : currentNetColor(),
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
      syncNetColorFromSelection();
    }

    state.selectedUid = typeof snapshot.selectedUid === 'string' ? snapshot.selectedUid : null;
    state.selectedUids = Array.isArray(snapshot.selectedUids)
      ? snapshot.selectedUids.map((uid) => String(uid || '')).filter(Boolean)
      : state.selectedUid
        ? [state.selectedUid]
        : [];
    state.selectedAnchorIndex = Number.isInteger(snapshot.selectedAnchorIndex)
      ? snapshot.selectedAnchorIndex
      : null;
    state.selectedHoleIndex = Number.isInteger(snapshot.selectedHoleIndex)
      ? snapshot.selectedHoleIndex
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
      version: 4,
      side: state.side,
      layerImage: state.layerImage,
      tool: state.tool,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      mirror: !!elements.mirror.checked,
      nextUid: state.nextUid,
      nextGroupUid: state.nextGroupUid,
      selectedUid: state.selectedUid,
      selectedUids: selectedPathUids(),
      selectedGroupId: state.selectedGroupId,
      selectedAnchorIndex: state.selectedAnchorIndex,
      selectedHoleIndex: state.selectedHoleIndex,
      helpPanels: {
        tools: state.helpPanels.tools === true,
        paths: state.helpPanels.paths === true,
      },
      groups: state.groups.map((group) => ({
        id: group.id,
        name: group.name,
        order: group.order,
        defaultOn: group.defaultOn !== false,
        netIds: normalizeGroupNetIds(group.netIds),
      })),
      form: {
        netId: elements.netId.value,
        netLabel: elements.netLabel.value,
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

    const validTools = ['select', 'polygon', 'subtract', 'line', 'magnet', 'pan'];
    state.tool = validTools.includes(data.tool) ? data.tool : 'select';

    state.zoom = clamp(parseFloat(data.zoom) || 1, 0.25, 40);
    state.panX = Number.isFinite(data.panX) ? data.panX : 20;
    state.panY = Number.isFinite(data.panY) ? data.panY : 20;
    elements.mirror.checked = !!data.mirror;

    const frontRaw = Array.isArray(data?.sides?.front) ? data.sides.front : [];
    const backRaw = Array.isArray(data?.sides?.back) ? data.sides.back : [];
    const draftVersion = parseInt(data?.version, 10);
    const normalizedDraftVersion = Number.isFinite(draftVersion) ? draftVersion : 1;

    state.sides.front.paths = frontRaw
      .map((entry) => normalizePath({ ...entry, draftVersion: normalizedDraftVersion }))
      .filter(Boolean)
      .map((path, i) => {
        const netId = withSidePrefix(path.netId, 'front') || `front-net-${Date.now() + i}`;
        return {
          ...path,
        uid: path.uid || `p-${i + 1}`,
          netId,
          category: String(path.category || categoryFromNetId(netId)),
        };
      });

    const offset = state.sides.front.paths.length;
    state.sides.back.paths = backRaw
      .map((entry) => normalizePath({ ...entry, draftVersion: normalizedDraftVersion }))
      .filter(Boolean)
      .map((path, i) => {
        const netId = withSidePrefix(path.netId, 'back') || `back-net-${Date.now() + i}`;
        return {
          ...path,
        uid: path.uid || `p-${offset + i + 1}`,
          netId,
          category: String(path.category || categoryFromNetId(netId)),
        };
      });

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
    state.groups = normalizeGroups(data.groups);
    const explicitNextGroupUid = parseInt(data.nextGroupUid, 10);
    const nextGroupFloor = inferNextGroupUid(state.groups);
    state.nextGroupUid = Number.isFinite(explicitNextGroupUid)
      ? Math.max(explicitNextGroupUid, nextGroupFloor)
      : nextGroupFloor;

    state.selectedUid = typeof data.selectedUid === 'string' ? data.selectedUid : null;
    state.selectedUids = Array.isArray(data.selectedUids)
      ? data.selectedUids.map((uid) => String(uid || '')).filter(Boolean)
      : state.selectedUid
        ? [state.selectedUid]
        : [];
    state.selectedGroupId = typeof data.selectedGroupId === 'string' ? data.selectedGroupId : null;
    state.selectedAnchorIndex = Number.isInteger(data.selectedAnchorIndex)
      ? data.selectedAnchorIndex
      : null;
    state.selectedHoleIndex = Number.isInteger(data.selectedHoleIndex)
      ? data.selectedHoleIndex
      : null;
    state.helpPanels = normalizeHelpPanelState(data.helpPanels);

    if (data.form && typeof data.form === 'object') {
      elements.netId.value = normalizeNetKey(String(data.form.netId || ''));
      elements.netLabel.value = String(data.form.netLabel || '');
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

function normalizeSelectedUids(uids) {
  const valid = new Set(currentPaths().map((path) => path.uid));
  const source = Array.isArray(uids) ? uids : [];
  const deduped = [];
  source.forEach((uid) => {
    const id = String(uid || '');
    if (!id || !valid.has(id) || deduped.includes(id)) return;
    deduped.push(id);
  });
  return deduped;
}

function selectedPathUids() {
  const multi = normalizeSelectedUids(state.selectedUids);
  if (multi.length) return multi;
  if (state.selectedUid && currentPaths().some((path) => path.uid === state.selectedUid)) {
    return [state.selectedUid];
  }
  return [];
}

function ensurePrimarySelection() {
  const paths = currentPaths();
  if (!paths.length) {
    state.selectedUid = null;
    state.selectedUids = [];
    return null;
  }

  const selected = normalizeSelectedUids(state.selectedUids);
  const valid = new Set(paths.map((path) => path.uid));
  const hasPrimary = !!state.selectedUid && valid.has(state.selectedUid);

  if (hasPrimary) {
    if (!selected.length) {
      state.selectedUids = [state.selectedUid];
    } else if (!selected.includes(state.selectedUid)) {
      state.selectedUids = [state.selectedUid, ...selected];
    } else {
      state.selectedUids = selected;
    }
    return state.selectedUid;
  }

  const fallbackUid = selected[0] || paths[0].uid;
  state.selectedUid = fallbackUid;
  if (!selected.length) {
    state.selectedUids = [fallbackUid];
  } else if (!selected.includes(fallbackUid)) {
    state.selectedUids = [fallbackUid, ...selected];
  } else {
    state.selectedUids = selected;
  }
  return fallbackUid;
}

function updateMergeButtonState() {
  if (!elements.mergePaths) return;
  elements.mergePaths.disabled = selectedPathUids().length < 2;
}

function normalizeGroupNetIds(netIds) {
  const source = Array.isArray(netIds) ? netIds : [];
  const normalized = [];
  source.forEach((netId) => {
    const key = normalizeNetKey(netId);
    if (!key.length || normalized.includes(key)) return;
    normalized.push(key);
  });
  return normalized;
}

function normalizeGroup(raw, fallbackIndex = 0) {
  const fallbackName = `Group ${fallbackIndex + 1}`;
  const name = String(raw?.name || '').trim() || fallbackName;
  const orderRaw = parseInt(raw?.order, 10);
  const order = Number.isFinite(orderRaw) ? orderRaw : fallbackIndex;
  const defaultOn = raw?.defaultOn !== false;
  const netIds = normalizeGroupNetIds(raw?.netIds);
  const id = String(raw?.id || '').trim() || `g-${fallbackIndex + 1}`;
  return { id, name, order, defaultOn, netIds };
}

function normalizeGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  const groups = [];
  const seen = new Set();
  rawGroups.forEach((raw, index) => {
    const group = normalizeGroup(raw, index);
    let id = group.id;
    if (seen.has(id) || !id.length) {
      let n = index + 1;
      while (seen.has(`g-${n}`)) n += 1;
      id = `g-${n}`;
    }
    seen.add(id);
    groups.push({ ...group, id });
  });
  return groups;
}

function inferNextGroupUid(groups = state.groups) {
  let max = 0;
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const match = String(group?.id || '').match(/^g-(\d+)$/);
    if (!match) return;
    max = Math.max(max, parseInt(match[1], 10));
  });
  return max + 1;
}

function sortedGroups() {
  return [...state.groups].sort((a, b) => {
    const ao = parseInt(a.order, 10);
    const bo = parseInt(b.order, 10);
    const orderA = Number.isFinite(ao) ? ao : 0;
    const orderB = Number.isFinite(bo) ? bo : 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function groupLabel(group) {
  if (!group) return '';
  const orderRaw = parseInt(group.order, 10);
  const order = Number.isFinite(orderRaw) ? orderRaw : 0;
  const name = String(group.name || '').trim() || 'Group';
  const count = Array.isArray(group.netIds) ? group.netIds.length : 0;
  return `${order} · ${name} (${count})`;
}

function groupsModalOpen() {
  return !!elements.groupsModal && !elements.groupsModal.hidden;
}

function currentKnownNetIds() {
  const known = [];
  ['front', 'back'].forEach((side) => {
    const paths = state.sides[side]?.paths || [];
    paths.forEach((path) => {
      const key = normalizeNetKey(path?.netId);
      if (!key.length || known.includes(key)) return;
      known.push(key);
    });
  });
  return known.sort((a, b) => a.localeCompare(b));
}

function selectedGroup() {
  if (!state.selectedGroupId) return null;
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

function ensureSelectedGroup() {
  if (!state.groups.length) {
    state.selectedGroupId = null;
    return null;
  }
  if (!selectedGroup()) {
    state.selectedGroupId = sortedGroups()[0].id;
  }
  return selectedGroup();
}

function renderSimpleOptions(select, values) {
  if (!select) return;
  select.innerHTML = '';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function renderGroupsModal() {
  if (!elements.groupsModal) return;

  const groups = sortedGroups();
  elements.groupsList.innerHTML = '';
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = groupLabel(group);
    elements.groupsList.append(option);
  });

  const group = ensureSelectedGroup();
  if (group) {
    elements.groupsList.value = group.id;
  }

  const hasGroup = !!group;
  elements.groupDelete.disabled = !hasGroup;
  elements.groupSave.disabled = !hasGroup;
  elements.groupName.disabled = !hasGroup;
  elements.groupOrder.disabled = !hasGroup;
  elements.groupDefaultOn.disabled = !hasGroup;
  elements.groupNetAvailable.disabled = !hasGroup;
  elements.groupNetMembers.disabled = !hasGroup;

  if (!hasGroup) {
    elements.groupName.value = '';
    elements.groupOrder.value = '0';
    elements.groupDefaultOn.checked = true;
    renderSimpleOptions(elements.groupNetAvailable, currentKnownNetIds());
    renderSimpleOptions(elements.groupNetMembers, []);
    elements.groupAddNet.disabled = true;
    elements.groupRemoveNet.disabled = true;
    return;
  }

  elements.groupName.value = group.name;
  elements.groupOrder.value = String(group.order);
  elements.groupDefaultOn.checked = !!group.defaultOn;

  const knownNetIds = currentKnownNetIds();
  const memberSet = new Set(group.netIds);
  const available = knownNetIds.filter((netId) => !memberSet.has(netId));
  const members = [...group.netIds].sort((a, b) => a.localeCompare(b));
  renderSimpleOptions(elements.groupNetAvailable, available);
  renderSimpleOptions(elements.groupNetMembers, members);

  elements.groupAddNet.disabled = !available.length;
  elements.groupRemoveNet.disabled = !members.length;
}

function syncSelectedGroupListLabel() {
  const group = selectedGroup();
  if (!group) return;
  const option = Array.from(elements.groupsList.options).find((entry) => entry.value === group.id);
  if (!option) return;
  option.textContent = groupLabel(group);
}

function applySelectedGroupForm({ save = true, announce = false, rerender = true } = {}) {
  const group = selectedGroup();
  if (!group) return false;

  const nextName = String(elements.groupName.value || '').trim();
  const orderRaw = parseInt(elements.groupOrder.value, 10);
  const nextOrder = Number.isFinite(orderRaw) ? orderRaw : 0;
  const nextDefaultOn = !!elements.groupDefaultOn.checked;

  if (nextName.length) {
    group.name = nextName;
  }
  group.order = nextOrder;
  group.defaultOn = nextDefaultOn;

  if (rerender) {
    renderGroupsModal();
  } else {
    syncSelectedGroupListLabel();
  }
  if (save) saveDraft();
  if (announce) setStatus(`Saved group ${group.name}.`);
  return true;
}

function refreshGroupsModalIfOpen() {
  if (!groupsModalOpen()) return;
  renderGroupsModal();
}

function openGroupsModal() {
  if (!elements.groupsModal) return;
  renderGroupsModal();
  elements.groupsModal.hidden = false;
}

function closeGroupsModal() {
  if (!elements.groupsModal) return;
  elements.groupsModal.hidden = true;
}

function createGroup() {
  const id = `g-${state.nextGroupUid++}`;
  const group = normalizeGroup(
    {
      id,
      name: `Group ${state.groups.length + 1}`,
      order: state.groups.length,
      defaultOn: true,
      netIds: [],
    },
    state.groups.length
  );
  state.groups.push(group);
  state.selectedGroupId = group.id;
  renderGroupsModal();
  saveDraft();
  setStatus(`Created ${group.name}.`);
}

function deleteSelectedGroup() {
  const group = selectedGroup();
  if (!group) {
    setStatus('Select a group to delete.');
    return;
  }
  state.groups = state.groups.filter((entry) => entry.id !== group.id);
  state.selectedGroupId = null;
  ensureSelectedGroup();
  renderGroupsModal();
  saveDraft();
  setStatus(`Deleted ${group.name}.`);
}

function saveSelectedGroupDetails() {
  if (!selectedGroup()) {
    setStatus('Select a group first.');
    return;
  }
  applySelectedGroupForm({ save: true, announce: true, rerender: true });
}

function addNetIdsToSelectedGroup() {
  const group = selectedGroup();
  if (!group) {
    setStatus('Select a group first.');
    return;
  }
  const selected = Array.from(elements.groupNetAvailable.selectedOptions)
    .map((option) => normalizeNetKey(option.value))
    .filter(Boolean);
  if (!selected.length) return;
  group.netIds = normalizeGroupNetIds([...group.netIds, ...selected]);
  renderGroupsModal();
  saveDraft();
  setStatus(`Added ${selected.length} net id(s) to ${group.name}.`);
}

function removeNetIdsFromSelectedGroup() {
  const group = selectedGroup();
  if (!group) {
    setStatus('Select a group first.');
    return;
  }
  const selected = new Set(
    Array.from(elements.groupNetMembers.selectedOptions)
      .map((option) => normalizeNetKey(option.value))
      .filter(Boolean)
  );
  if (!selected.size) return;
  group.netIds = group.netIds.filter((netId) => !selected.has(netId));
  renderGroupsModal();
  saveDraft();
  setStatus(`Removed ${selected.size} net id(s) from ${group.name}.`);
}

function syncNetColorFromSelection() {
  const path = activePath();
  if (path && typeof path.color === 'string' && path.color.trim().length > 0) {
    elements.color.value = normalizeHexColor(path.color, '#ffe05e');
    return;
  }
  elements.color.value = currentNetColor();
}

function oppositeSide(side = state.side) {
  return side === 'back' ? 'front' : 'back';
}

function findNetTemplateOnSide(netKey, side = state.side, options = {}) {
  const { excludeUid = null } = options;
  const targetKey = normalizeNetKey(netKey);
  if (!targetKey.length) return null;
  const paths = state.sides[side]?.paths || [];
  return (
    paths.find((path) => {
      if (!path) return false;
      if (excludeUid && path.uid === excludeUid) return false;
      return normalizeNetKey(path.netId) === targetKey;
    }) || null
  );
}

function forEachPathByNetKey(netKey, callback) {
  const targetKey = normalizeNetKey(netKey);
  if (!targetKey.length || typeof callback !== 'function') return 0;
  let count = 0;
  ['front', 'back'].forEach((side) => {
    const paths = state.sides[side]?.paths || [];
    paths.forEach((path) => {
      if (normalizeNetKey(path.netId) !== targetKey) return;
      callback(path, side);
      count += 1;
    });
  });
  return count;
}

function applyColorToNet(netId, color, options = {}) {
  const { save = true, announce = false, recordUndo = false } = options;
  const targetNetKey = normalizeNetKey(netId);
  if (!targetNetKey) {
    if (announce) setStatus('Enter a net id first.');
    return;
  }

  const previousColor = currentNetColor();
  const nextColor = normalizeHexColor(color, '#ffe05e');
  let hasChange = false;
  const matchedCount = forEachPathByNetKey(targetNetKey, (path) => {
    const current = normalizeHexColor(path.color, nextColor);
    if (current !== nextColor) hasChange = true;
  });
  if (recordUndo && hasChange) {
    recordUndoSnapshot('Change net color', { layerColor: previousColor });
  }

  elements.color.value = nextColor;
  forEachPathByNetKey(targetNetKey, (path) => {
    path.color = nextColor;
  });
  renderOverlay();
  if (announce) {
    const suffix = matchedCount ? ` to ${matchedCount} path(s) across both sides` : '';
    setStatus(`Applied net color${suffix}.`);
  }
  if (save) saveDraft();
}

function activePath() {
  const uid = ensurePrimarySelection();
  if (!uid) return null;
  return currentPaths().find((entry) => entry.uid === uid) || null;
}

function ensureSelectedPath() {
  const selectedUid = ensurePrimarySelection();
  if (!selectedUid) {
    state.selectedAnchorIndex = null;
    state.selectedHoleIndex = null;
    return;
  }

  state.selectedAnchorIndex = null;
  state.selectedHoleIndex = null;

  const selectedPath = activePath();
  if (!selectedPath || !Array.isArray(selectedPath.points)) {
    state.selectedAnchorIndex = null;
    state.selectedHoleIndex = null;
    return;
  }
  state.selectedHoleIndex = normalizeSelectedHoleIndex(selectedPath, state.selectedHoleIndex);
  const contour = getContourData(selectedPath, state.selectedHoleIndex);
  if (!Number.isInteger(state.selectedAnchorIndex)) return;
  if (state.selectedAnchorIndex < 0 || state.selectedAnchorIndex >= contour.points.length) {
    state.selectedAnchorIndex = null;
  }
}

function updatePathGeometry(path) {
  if (!path || !Array.isArray(path.points)) return;
  const minPoints = normalizePathKind(path.pathKind) === 'line' ? 2 : 3;
  if (path.points.length < minPoints) return;
  path.pointModes = normalizePointModes(path.pointModes, path.points.length, 'corner');
  path.holes = Array.isArray(path.holes)
    ? path.holes
        .map(normalizeHole)
        .filter(Boolean)
        .map((hole) => ({
          points: hole.points,
          pointModes: normalizePointModes(hole.pointModes, hole.points.length, 'corner'),
        }))
    : [];
  path.d = buildPathD(path);
}

function findNearestSegmentIndex(points, point, closed = true) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const segmentCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i += 1) {
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

function showNodeMenu({ clientX, clientY, mode, anchorIndex = null, holeIndex = null, point = null }) {
  state.nodeMenuState = { mode, anchorIndex, holeIndex, point };

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
  if (!['select', 'polygon', 'subtract', 'line', 'magnet', 'pan'].includes(tool)) return;

  state.tool = tool;
  state.drawPoints = [];
  state.drawVias = [];
  state.drawing = null;
  if (tool !== 'select') {
    state.selectedAnchorIndex = null;
    state.selectedHoleIndex = null;
  }
  hideNodeMenu();

  elements.toolButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === tool);
  });

  renderOverlay();

  if (announce) {
    if (tool === 'polygon') {
      setStatus('Tool: polygon. Drag on the board to draw a new closed net shape.');
    } else if (tool === 'subtract') {
      setStatus('Tool: subtract. Select an area path, drag to draw a cutout, release to subtract.');
    } else if (tool === 'line') {
      setStatus('Tool: line. Drag to draw, press I to drop vias, Esc to finish.');
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
  elements.netId.value = normalizeNetKey(path.netId);
  elements.netLabel.value = path.netLabel;
  elements.color.value = normalizeHexColor(path.color, '#ffe05e');
  elements.strokeWidth.value = String(path.strokeWidth);
}

function readPathMetaFromForm() {
  const providedId = normalizeNetKey(elements.netId.value);
  const netId = withSidePrefix(providedId || `net-${Date.now()}`, state.side);
  const providedLabel = elements.netLabel.value.trim();

  return {
    netId,
    netLabel: providedLabel || normalizeNetKey(netId),
    category: categoryFromNetId(netId),
    color: currentNetColor(),
    strokeWidth: clamp(parseFloat(elements.strokeWidth.value) || 1, 0.1, 20),
  };
}

function refreshPathList() {
  const paths = currentPaths();
  const selectedSet = new Set(selectedPathUids());
  elements.pathList.innerHTML = '';

  paths.forEach((path) => {
    const option = document.createElement('option');
    option.value = path.uid;
    const modes = Array.isArray(path.pointModes) ? path.pointModes : [];
    const hasSmooth = modes.some((mode) => mode === 'smooth');
    const hasCorner = modes.some((mode) => mode !== 'smooth');
    const mode = hasSmooth && hasCorner ? 'mixed' : hasSmooth ? 'smooth' : 'corner';
    const netKey = normalizeNetKey(path.netId) || 'uncategorized';
    option.textContent = `${path.netLabel} (${netKey}, ${mode})`;
    option.selected = selectedSet.has(path.uid);
    elements.pathList.append(option);
  });

  updateMergeButtonState();
  refreshGroupsModalIfOpen();
}

function selectPath(uid, options = {}) {
  const { save = true, bringIntoView = true } = options;
  state.selectedUid = uid;
  state.selectedUids = uid ? [uid] : [];
  state.selectedAnchorIndex = null;
  state.selectedHoleIndex = null;
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

function pathDForMerge(path) {
  if (!path) return '';
  const kind = normalizePathKind(path.pathKind);
  if (kind === 'line') {
    return buildLineExportPathD(path) || String(path.d || '').trim();
  }
  return String(path.d || '').trim();
}

function mergeSelectedPaths() {
  const uids = selectedPathUids();
  if (uids.length < 2) {
    setStatus('Select at least 2 paths in the list to merge.');
    return;
  }

  const paths = currentPaths();
  const indexByUid = new Map(paths.map((path, index) => [path.uid, index]));
  const selected = uids
    .map((uid) => paths[indexByUid.get(uid)])
    .filter(Boolean);

  if (selected.length < 2) {
    setStatus('Select at least 2 valid paths to merge.');
    return;
  }

  const mergedParts = selected
    .map((path) => pathDForMerge(path))
    .filter((value) => value.length > 0);
  if (!mergedParts.length) {
    setStatus('Could not merge: selected paths have no geometry.');
    return;
  }

  const primary = selected[0];
  const mergedD = mergedParts.join(' ');
  const mergedGeometry = buildMergedGeometryFromSelection(selected);
  const mergedFillRule = mergedGeometry?.fillRule || 'evenodd';
  const selectedSet = new Set(selected.map((path) => path.uid));
  const firstIndex = Math.min(...selected.map((path) => indexByUid.get(path.uid)));
  const sourceModeSamples = collectModeSamplesFromPaths(selected);
  let mergedPoints = mergedGeometry?.points || null;
  let mergedPointModes = mergedGeometry?.pointModes || [];
  let mergedHoles = mergedGeometry?.holes || [];
  let finalD = mergedGeometry?.d || mergedD;

  if (!mergedPoints) {
    const editableSource =
      selected.find((path) => normalizePathKind(path.pathKind) !== 'line' && Array.isArray(path.points) && path.points.length >= 3) ||
      selected.find((path) => Array.isArray(path.points) && path.points.length >= 3) ||
      primary;
    mergedPoints =
      Array.isArray(editableSource.points) && editableSource.points.length >= 3
        ? editableSource.points.map((point) => [point[0], point[1]])
        : null;
    if (!mergedPoints) {
      mergedPoints = extractEditableContourFromPathD(finalD, 3);
    }
    mergedPointModes = Array.isArray(mergedPoints)
      ? inferPointModesFromSamples(
          mergedPoints,
          sourceModeSamples.length ? sourceModeSamples : contourModeSamples(editableSource.points, editableSource.pointModes)
        )
      : [];
    mergedHoles = [];
  }

  recordUndoSnapshot('Merge paths', { pathLabel: primary.netLabel });

  const mergedPath = {
    uid: `p-${state.nextUid++}`,
    d: finalD,
    netId: primary.netId,
    netLabel: primary.netLabel,
    category: primary.category || categoryFromNetId(primary.netId),
    color: primary.color,
    strokeWidth: clamp(parseFloat(primary.strokeWidth) || 1, 0.1, 20),
    pathKind: 'area',
    fillRule: mergedFillRule,
    holes: mergedHoles,
    vias: [],
    points: mergedPoints,
    pointModes: mergedPointModes,
  };

  const remaining = paths.filter((path) => !selectedSet.has(path.uid));
  remaining.splice(firstIndex, 0, mergedPath);
  state.sides[state.side].paths = remaining;
  state.selectedUid = mergedPath.uid;
  state.selectedUids = [mergedPath.uid];
  state.selectedAnchorIndex = null;
  state.selectedHoleIndex = null;

  assignFormDefaults(mergedPath);
  refreshPathList();
  renderOverlay();
  ensurePathVisible(mergedPath);
  const loopInfo = mergedGeometry && Number.isInteger(mergedGeometry.loopCount) ? ` (${mergedGeometry.loopCount} contour${mergedGeometry.loopCount === 1 ? '' : 's'})` : '';
  setStatus(`Merged ${selected.length} paths into ${mergedPath.netLabel}${loopInfo}.`);
  saveDraft();
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
  const isLine = normalizePathKind(path.pathKind) === 'line';
  const fillRule = normalizeFillRule(path.fillRule, path.pathKind);
  const visual = document.createElementNS(SVG_NS, 'path');
  visual.setAttribute('d', path.d);
  visual.setAttribute('stroke', path.color);
  visual.setAttribute('stroke-width', String(path.strokeWidth));
  if (isLine) {
    visual.setAttribute('fill', 'none');
    visual.setAttribute('fill-opacity', '0');
  } else {
    visual.setAttribute('fill', path.color);
    visual.setAttribute('fill-opacity', state.debugFillOpacity.toFixed(2));
    visual.setAttribute('fill-rule', fillRule);
    visual.setAttribute('clip-rule', fillRule);
  }
  visual.setAttribute('class', 'net-path is-selected');
  visual.dataset.uid = path.uid;

  const hit = visual.cloneNode(false);
  hit.setAttribute('class', 'net-hit');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', String(Math.max(8, path.strokeWidth * 10)));
  hit.dataset.uid = path.uid;

  return [visual, hit];
}

function createAnchorsForContour(path, points, pointModes, holeIndex = null) {
  if (!Array.isArray(points) || points.length < 1) return [];
  const isHole = Number.isInteger(holeIndex);

  return points.flatMap((point, index) => {
    const [x, y] = point;
    const isSelected =
      state.selectedAnchorIndex === index &&
      (isHole ? state.selectedHoleIndex === holeIndex : !Number.isInteger(state.selectedHoleIndex));

    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', x.toFixed(2));
    hit.setAttribute('cy', y.toFixed(2));
    hit.setAttribute('r', ANCHOR_HIT_RADIUS_PX.toFixed(2));
    hit.setAttribute('class', 'net-anchor-hit');
    hit.dataset.uid = path.uid;
    hit.dataset.anchorIndex = String(index);
    if (isHole) {
      hit.dataset.holeIndex = String(holeIndex);
    }
    applyAnchorScreenScale(hit, x, y);

    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('cx', x.toFixed(2));
    marker.setAttribute('cy', y.toFixed(2));
    marker.setAttribute('r', (isSelected ? ANCHOR_MARKER_SELECTED_RADIUS_PX : ANCHOR_MARKER_RADIUS_PX).toFixed(2));
    marker.setAttribute('class', 'net-anchor');
    if (Array.isArray(pointModes) && pointModes[index] === 'smooth') {
      marker.classList.add('is-smooth');
    }
    if (isSelected) {
      marker.classList.add('is-selected');
    }
    marker.dataset.uid = path.uid;
    marker.dataset.anchorIndex = String(index);
    if (isHole) {
      marker.dataset.holeIndex = String(holeIndex);
    }
    applyAnchorScreenScale(marker, x, y);

    return [hit, marker];
  });
}

function createAnchorElements(path) {
  if (!path || !Array.isArray(path.points) || path.points.length < 1) return [];
  const anchors = [
    ...createAnchorsForContour(path, path.points, path.pointModes, null),
  ];
  if (Array.isArray(path.holes) && path.holes.length) {
    path.holes.forEach((rawHole, holeIndex) => {
      const hole = normalizeHole(rawHole);
      if (!hole) return;
      path.holes[holeIndex] = hole;
      anchors.push(...createAnchorsForContour(path, hole.points, hole.pointModes, holeIndex));
    });
  }
  return anchors;
}

function renderOverlay() {
  elements.overlay.innerHTML = '';

  const path = activePath();
  if (path) {
    if (normalizePathKind(path.pathKind) !== 'line' && (!Array.isArray(path.points) || path.points.length < 3)) {
      const recoveredPoints = extractEditableContourFromPathD(path.d, 3);
      if (Array.isArray(recoveredPoints) && recoveredPoints.length >= 3) {
        path.points = recoveredPoints;
        path.pointModes = normalizePointModes(path.pointModes, recoveredPoints.length, 'corner');
      }
    }
    const [visual, hit] = createPathElements(path);
    elements.overlay.append(visual, hit, ...createAnchorElements(path));
  }

  if (state.drawPoints.length > 1) {
    const draft = document.createElementNS(SVG_NS, 'path');
    const isLine = normalizePathKind(state.tool) === 'line';
    const d = pointsToPath(state.drawPoints, null, !isLine);
    if (d) draft.setAttribute('d', d);
    draft.setAttribute('class', 'net-draft');
    draft.setAttribute('stroke', currentNetColor());
    if (isLine) {
      draft.setAttribute('fill', 'none');
      draft.setAttribute('fill-opacity', '0');
    } else {
      draft.setAttribute('fill', currentNetColor());
      draft.setAttribute('fill-opacity', state.debugFillOpacity.toFixed(2));
    }
    elements.overlay.append(draft);

    if (isLine && Array.isArray(state.drawVias) && state.drawVias.length) {
      state.drawVias.forEach((via) => {
        const [x, y, r] = via;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', x.toFixed(2));
        circle.setAttribute('cy', y.toFixed(2));
        circle.setAttribute('r', (Number.isFinite(r) ? r : LINE_VIA_RADIUS).toFixed(2));
        circle.setAttribute('class', 'net-via-draft');
        elements.overlay.append(circle);
      });
    }
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

function addPathFromPoints(points, options = {}) {
  const { pathKind = 'area', vias = [] } = options;
  const kind = normalizePathKind(pathKind);
  const minPoints = kind === 'line' ? 2 : 3;
  if (!Array.isArray(points) || points.length < minPoints) {
    if (kind === 'line') {
      setStatus('Line draw needs at least 2 points.');
    } else {
      setStatus('Polygon draw needs at least 3 points.');
    }
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
    d: '',
    netId: meta.netId,
    netLabel: meta.netLabel,
    category: meta.category,
    color: meta.color,
    strokeWidth: meta.strokeWidth,
    pathKind: kind,
    fillRule: kind === 'line' ? 'nonzero' : 'evenodd',
    holes: [],
    vias: Array.isArray(vias)
      ? vias
          .map((via) => {
            if (!Array.isArray(via) || via.length < 2) return null;
            const x = clamp(parseFloat(via[0]), 0, CANVAS_SIZE);
            const y = clamp(parseFloat(via[1]), 0, CANVAS_SIZE);
            const r = clamp(parseFloat(via[2]) || LINE_VIA_RADIUS, 0.5, 80);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return [x, y, r];
          })
          .filter(Boolean)
      : [],
    points: normalizedPoints,
    pointModes: Array.from({ length: normalizedPoints.length }, () => 'corner'),
  };
  updatePathGeometry(path);

  currentPaths().push(path);
  applyColorToNet(meta.netId, meta.color, { save: false, announce: false, recordUndo: false });
  selectPath(path.uid, { save: false });
  setStatus(kind === 'line' ? `Added line ${path.netLabel}.` : `Added ${path.netLabel}.`);
  saveDraft();
}

function subtractFromSelectedPath(points) {
  const path = activePath();
  if (!path) {
    setStatus('Select an area path first, then draw subtract shape.');
    return;
  }
  if (normalizePathKind(path.pathKind) === 'line') {
    setStatus('Subtract is only available on area paths.');
    return;
  }
  if (!Array.isArray(points) || points.length < 3) {
    setStatus('Subtract draw needs at least 3 points.');
    return;
  }

  const hole = normalizeHole({
    points: points.map((point) => [clamp(point[0], 0, CANVAS_SIZE), clamp(point[1], 0, CANVAS_SIZE)]),
    pointModes: Array.from({ length: points.length }, () => 'corner'),
  });
  if (!hole) {
    setStatus('Subtract shape is invalid.');
    return;
  }

  recordUndoSnapshot('Subtract shape', { path });
  if (!Array.isArray(path.holes)) path.holes = [];
  path.holes.push(hole);
  updatePathGeometry(path);
  renderOverlay();
  setStatus(`Subtracted shape from ${path.netLabel}.`);
  saveDraft();
}

function commitDrawPath() {
  const isLineTool = normalizePathKind(state.tool) === 'line';
  const isSubtractTool = state.tool === 'subtract';
  const minPoints = isLineTool ? 2 : 3;
  if (state.drawPoints.length < minPoints) {
    state.drawPoints = [];
    state.drawVias = [];
    renderOverlay();
    return;
  }

  const points = state.drawPoints;
  const vias = state.drawVias;
  state.drawPoints = [];
  state.drawVias = [];
  if (isSubtractTool) {
    subtractFromSelectedPath(points);
    renderOverlay();
    return;
  }
  addPathFromPoints(points, { pathKind: isLineTool ? 'line' : 'area', vias });
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
  const targetNetKey = normalizeNetKey(meta.netId);
  const matchedCount = forEachPathByNetKey(targetNetKey, (entry) => {
    entry.netLabel = meta.netLabel;
    entry.category = meta.category;
    entry.color = normalizeHexColor(meta.color, '#ffe05e');
  });
  applyColorToNet(meta.netId, meta.color, { save: false, announce: false, recordUndo: false });

  refreshPathList();
  renderOverlay();
  const suffix = matchedCount ? ` (${matchedCount} path(s) across both sides).` : '.';
  setStatus(`Updated ${path.netLabel}. Net label and color synced by net id${suffix}`);
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
  state.selectedHoleIndex = null;

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

  const contour = getContourData(path, state.selectedHoleIndex);
  if (!Array.isArray(contour.points) || contour.points.length < 3 || !Array.isArray(contour.pointModes)) {
    setStatus('Selected path does not have editable node modes.');
    return;
  }

  if (!Number.isInteger(state.selectedAnchorIndex)) {
    setStatus('Select an anchor node first, then toggle its curve mode.');
    return;
  }

  if (state.selectedAnchorIndex < 0 || state.selectedAnchorIndex >= contour.pointModes.length) {
    setStatus('Selected node is out of range.');
    return;
  }

  const current = contour.pointModes[state.selectedAnchorIndex] === 'smooth' ? 'smooth' : 'corner';
  const next = current === 'smooth' ? 'corner' : 'smooth';
  recordUndoSnapshot('Toggle node curve', { path });
  contour.pointModes[state.selectedAnchorIndex] = next;
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    path.holes[contour.holeIndex].pointModes = contour.pointModes;
  } else {
    path.pointModes = contour.pointModes;
  }
  updatePathGeometry(path);

  refreshPathList();
  renderOverlay();
  setStatus(`Node ${state.selectedAnchorIndex + 1} on ${contourName(path, contour.holeIndex)}: ${next}.`);
  saveDraft();
}

function resetSelectedPathCurves() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }
  if (!Array.isArray(path.points) || !path.points.length) {
    setStatus('Selected path has no editable nodes.');
    return;
  }

  const before = modeStats(normalizePointModes(path.pointModes, path.points.length, 'corner'));
  if (before.smooth === 0) {
    setStatus(`Path ${path.netLabel} is already all corner.`);
    return;
  }

  recordUndoSnapshot('Reset path curves', { path });
  setAllPathModes(path, 'corner');
  refreshPathList();
  renderOverlay();
  const after = modeStats(path.pointModes);
  setStatus(`Reset ${path.netLabel} to corner nodes (${before.smooth}/${before.total} -> ${after.smooth}/${after.total} smooth).`);
  saveDraft();
}

function simplifySelectedPath() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }
  const contour = getContourData(path, state.selectedHoleIndex);
  const isLine = normalizePathKind(path.pathKind) === 'line' && !contour.isHole;
  if (!Array.isArray(contour.points) || contour.points.length < (isLine ? 3 : 4)) {
    setStatus('Selected contour does not have enough editable points to simplify.');
    return;
  }

  const epsilon = clamp(parseFloat(elements.simplifyEpsilon.value) || 3, 0.1, 50);
  const before = contour.points.length;
  const simplified = isLine
    ? simplifyRdpOpen(contour.points, epsilon).map((point) => [point[0], point[1]])
    : simplifyClosedPolygon(contour.points, epsilon);
  if (simplified.length >= before) {
    setStatus(`No points removed (tolerance ${epsilon.toFixed(1)}).`);
    return;
  }

  recordUndoSnapshot('Simplify path', { path });
  contour.points = simplified;
  contour.pointModes = normalizePointModes(contour.pointModes, contour.points.length, 'corner');
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    path.holes[contour.holeIndex].points = contour.points;
    path.holes[contour.holeIndex].pointModes = contour.pointModes;
  } else {
    path.points = contour.points;
    path.pointModes = contour.pointModes;
  }
  state.selectedAnchorIndex = null;
  updatePathGeometry(path);
  refreshPathList();
  renderOverlay();
  setStatus(`Simplified ${contourName(path, contour.holeIndex)}: ${before} -> ${simplified.length} points.`);
  saveDraft();
}

function smoothSelectedPath() {
  const path = activePath();
  if (!path) {
    setStatus('Select a path first.');
    return;
  }
  const contour = getContourData(path, state.selectedHoleIndex);
  if (!Array.isArray(contour.points) || contour.points.length < 3) {
    setStatus('Selected contour has no editable points to smooth.');
    return;
  }

  const strength = clamp(parseFloat(elements.smoothStrength.value) || 0.25, 0.05, 1);
  recordUndoSnapshot('Smooth path', { path });
  const isLine = normalizePathKind(path.pathKind) === 'line' && !contour.isHole;
  contour.points = isLine
    ? smoothOpenPolyline(contour.points, strength)
    : smoothClosedPolygon(contour.points, strength);
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    path.holes[contour.holeIndex].points = contour.points;
  } else {
    path.points = contour.points;
  }
  updatePathGeometry(path);
  renderOverlay();
  setStatus(`Smoothed ${contourName(path, contour.holeIndex)} (strength ${strength.toFixed(2)}).`);
  saveDraft();
}

function addNodeFromMenu() {
  const menu = state.nodeMenuState;
  const path = activePath();
  if (!menu || !path || !Array.isArray(path.points) || path.points.length < 2) {
    hideNodeMenu();
    return;
  }

  const contour = getContourData(path, menu.holeIndex);
  if (!Array.isArray(contour.points) || contour.points.length < 2) {
    hideNodeMenu();
    return;
  }
  const isLine = normalizePathKind(path.pathKind) === 'line' && !contour.isHole;
  const closed = !isLine;
  let insertPoint = menu.point;
  if (!insertPoint && Number.isInteger(menu.anchorIndex)) {
    const i = menu.anchorIndex;
    const next = isLine
      ? clamp(i + 1, 0, contour.points.length - 1)
      : (i + 1) % contour.points.length;
    if (isLine && i >= contour.points.length - 1 && contour.points.length >= 2) {
      const a = contour.points[contour.points.length - 2];
      const b = contour.points[contour.points.length - 1];
      insertPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    } else {
      const a = contour.points[i];
      const b = contour.points[next];
      insertPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
  }
  if (!insertPoint) {
    hideNodeMenu();
    return;
  }

  let segmentIndex;
  if (Number.isInteger(menu.anchorIndex)) {
    segmentIndex = isLine ? clamp(menu.anchorIndex, 0, contour.points.length - 2) : menu.anchorIndex;
  } else {
    segmentIndex = findNearestSegmentIndex(contour.points, insertPoint, closed);
  }

  const clamped = [
    clamp(insertPoint[0], 0, CANVAS_SIZE),
    clamp(insertPoint[1], 0, CANVAS_SIZE),
  ];
  recordUndoSnapshot('Add node', { path });
  contour.pointModes = normalizePointModes(contour.pointModes, contour.points.length, 'corner');
  contour.points.splice(segmentIndex + 1, 0, clamped);
  contour.pointModes.splice(segmentIndex + 1, 0, 'corner');
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    path.holes[contour.holeIndex].points = contour.points;
    path.holes[contour.holeIndex].pointModes = contour.pointModes;
    state.selectedHoleIndex = contour.holeIndex;
  } else {
    path.points = contour.points;
    path.pointModes = contour.pointModes;
    state.selectedHoleIndex = null;
  }
  state.selectedAnchorIndex = segmentIndex + 1;
  updatePathGeometry(path);
  renderOverlay();
  hideNodeMenu();
  setStatus(`Added node to ${contourName(path, contour.holeIndex)}.`);
  saveDraft();
}

function deleteNodeFromMenu() {
  const menu = state.nodeMenuState;
  const path = activePath();
  if (!menu || !path || !Array.isArray(path.points) || !Number.isInteger(menu.anchorIndex)) {
    hideNodeMenu();
    return;
  }

  const contour = getContourData(path, menu.holeIndex);
  if (!Array.isArray(contour.points) || !Number.isInteger(menu.anchorIndex)) {
    hideNodeMenu();
    return;
  }
  const minPoints = normalizePathKind(path.pathKind) === 'line' && !contour.isHole ? 2 : 3;
  if (contour.points.length <= minPoints) {
    hideNodeMenu();
    if (minPoints === 2) {
      setStatus('Cannot delete node: a line needs at least 2 points.');
    } else {
      setStatus('Cannot delete node: a closed path needs at least 3 points.');
    }
    return;
  }

  const index = clamp(menu.anchorIndex, 0, contour.points.length - 1);
  recordUndoSnapshot('Delete node', { path });
  const modes = normalizePointModes(contour.pointModes, contour.points.length, 'corner');
  const beforeModes = modes.slice();
  const beforeStats = modeStats(beforeModes);
  const beforeHasCubic = /\bC\b/i.test(path.d || '');
  contour.points.splice(index, 1);
  modes.splice(index, 1);
  contour.pointModes = modes;
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    path.holes[contour.holeIndex].points = contour.points;
    path.holes[contour.holeIndex].pointModes = contour.pointModes;
    state.selectedHoleIndex = contour.holeIndex;
  } else {
    path.points = contour.points;
    path.pointModes = contour.pointModes;
    state.selectedHoleIndex = null;
  }
  if (state.selectedAnchorIndex === index) {
    state.selectedAnchorIndex = null;
  } else if (Number.isInteger(state.selectedAnchorIndex) && state.selectedAnchorIndex > index) {
    state.selectedAnchorIndex -= 1;
  }
  updatePathGeometry(path);
  const afterStats = modeStats(contour.pointModes);
  const afterHasCubic = /\bC\b/i.test(path.d || '');
  renderOverlay();
  hideNodeMenu();
  setStatus(
    `Deleted node from ${contourName(path, contour.holeIndex)}. Debug smooth ${beforeStats.smooth}/${beforeStats.total} -> ${afterStats.smooth}/${afterStats.total}. Cubic ${beforeHasCubic ? 'yes' : 'no'} -> ${afterHasCubic ? 'yes' : 'no'}.`
  );
  console.debug('[delete-node]', {
    uid: path.uid,
    netLabel: path.netLabel,
    contour: contourName(path, contour.holeIndex),
    deletedIndex: index,
    beforeStats,
    afterStats,
    beforeModes,
    afterModes: Array.isArray(contour.pointModes) ? contour.pointModes.slice() : [],
    beforeHasCubic,
    afterHasCubic,
  });
  saveDraft();
}

function serializeGroupsForSvg() {
  const groups = sortedGroups().map((group) => ({
    id: String(group.id || ''),
    name: String(group.name || '').trim() || 'Group',
    order: Number.isFinite(parseInt(group.order, 10)) ? parseInt(group.order, 10) : 0,
    defaultOn: group.defaultOn !== false,
    netIds: normalizeGroupNetIds(group.netIds),
  }));
  return JSON.stringify(groups);
}

function applyGroupsFromSvgPayload(payload) {
  const raw = String(payload || '').trim();
  if (!raw.length) return false;
  try {
    const parsed = JSON.parse(raw);
    const groups = normalizeGroups(parsed);
    if (!groups.length) return false;
    state.groups = groups;
    state.nextGroupUid = Math.max(state.nextGroupUid, inferNextGroupUid(groups));
    ensureSelectedGroup();
    refreshGroupsModalIfOpen();
    return true;
  } catch (error) {
    console.warn('Could not parse SVG group metadata', error);
    return false;
  }
}

function serializeCurrentSideSvg() {
  const groupsJson = escapeXml(serializeGroupsForSvg());
  const body = currentPaths()
    .map((path) => {
      const exportedNetId = withSidePrefix(path.netId, state.side) || `${state.side}-net-${Date.now()}`;
      const exportedCategory = categoryFromNetId(exportedNetId);
      const pathKind = normalizePathKind(path.pathKind);
      const fillRule = normalizeFillRule(path.fillRule, pathKind);
      const exportD = pathKind === 'line' ? buildLineExportPathD(path) || path.d : path.d;
      const attrs = [
        `d="${escapeXml(exportD)}"`,
        `data-net-id="${escapeXml(exportedNetId)}"`,
        `data-net-label="${escapeXml(path.netLabel)}"`,
        `data-category="${escapeXml(exportedCategory)}"`,
        `data-color="${escapeXml(path.color)}"`,
        `fill="${escapeXml(path.color)}"`,
        `fill-opacity="1"`,
      ];

      attrs.push(`data-editor-kind="${escapeXml(pathKind)}"`);
      attrs.push('data-editor-mode-version="2"');
      if (pathKind !== 'line') {
        attrs.push(`data-editor-fill-rule="${escapeXml(fillRule)}"`);
        attrs.push(`fill-rule="${escapeXml(fillRule)}"`);
        attrs.push(`clip-rule="${escapeXml(fillRule)}"`);
      }

      const minPoints = pathKind === 'line' ? 2 : 3;
      if (Array.isArray(path.points) && path.points.length >= minPoints) {
        attrs.push(`data-editor-points="${escapeXml(serializePoints(path.points))}"`);
      }
      if (Array.isArray(path.pointModes) && path.pointModes.length >= minPoints) {
        attrs.push(`data-editor-point-modes="${escapeXml(serializePointModes(path.pointModes))}"`);
      }
      if (pathKind === 'line' && Array.isArray(path.vias) && path.vias.length) {
        attrs.push(`data-editor-vias="${escapeXml(serializeVias(path.vias))}"`);
      }
      if (pathKind !== 'line' && Array.isArray(path.holes) && path.holes.length) {
        attrs.push(`data-editor-holes="${escapeXml(serializeHoles(path.holes))}"`);
      }

      return `  <path ${attrs.join(' ')} />`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" data-net-groups="${groupsJson}">\n${body}\n</svg>\n`;
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
  applyGroupsFromSvgPayload(doc.documentElement?.dataset?.netGroups);

  doc.querySelectorAll('path[data-net-id]').forEach((node) => {
    const d = node.getAttribute('d');
    if (!d) return;

    const candidate = normalizePath({
      uid: `p-${state.nextUid++}`,
      d,
      netId: withSidePrefix(node.dataset.netId, side) || `${side}-net-${Date.now()}`,
      netLabel: node.dataset.netLabel,
      category: node.dataset.category || categoryFromNetId(withSidePrefix(node.dataset.netId, side)),
      color: node.dataset.color || node.getAttribute('stroke') || '#ffe05e',
      strokeWidth: node.dataset.strokeWidth || node.getAttribute('stroke-width') || '1',
      pathKind: node.dataset.editorKind,
      editorFillRule: node.dataset.editorFillRule || node.getAttribute('fill-rule'),
      editorModeVersion: node.dataset.editorModeVersion,
      curveMode: node.dataset.curveMode,
      editorPoints: node.dataset.editorPoints,
      editorPointModes: node.dataset.editorPointModes,
      editorVias: node.dataset.editorVias,
      editorHoles: node.dataset.editorHoles,
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
      syncNetColorFromSelection();
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
      state.selectedUids = [];
      state.selectedAnchorIndex = null;
      state.selectedHoleIndex = null;
      syncNetColorFromSelection();
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
  syncNetColorFromSelection();
  if (state.selectedUid) assignFormDefaults(activePath());
  refreshPathList();
  renderOverlay();
  setStatus(`Imported ${file.name} into ${state.side}.`);
  saveDraft(false);
}

async function createNewProject() {
  const confirmed = window.confirm(
    'Start a new project? This clears all paths, groups, and undo history on both sides.'
  );
  if (!confirmed) return;

  state.side = 'front';
  elements.side.value = 'front';
  state.layerImage = 1;
  elements.layerImage.value = '1';

  state.zoom = 1;
  state.panX = 20;
  state.panY = 20;
  elements.mirror.checked = false;

  state.tool = 'select';
  state.drawPoints = [];
  state.drawVias = [];
  state.drawing = null;
  state.anchorDrag = null;
  state.panning = null;
  state.lastPointerPoint = null;
  state.suppressOverlayClick = false;
  hideNodeMenu();

  state.selectedUid = null;
  state.selectedUids = [];
  state.selectedAnchorIndex = null;
  state.selectedHoleIndex = null;
  state.selectedGroupId = null;

  state.nextUid = 1;
  state.nextGroupUid = 1;
  state.groups = [];
  state.helpPanels = normalizeHelpPanelState(null);
  applyHelpPanels();

  state.sides.front.paths = [];
  state.sides.back.paths = [];
  state.sides.front.loaded = true;
  state.sides.back.loaded = true;
  resetUndoStack('front');
  resetUndoStack('back');

  elements.netId.value = '';
  elements.netLabel.value = '';
  elements.color.value = '#ffe05e';
  elements.strokeWidth.value = '1';
  setDebugFillOpacity(0.18, { save: false, announce: false });
  elements.simplifyEpsilon.value = '3';
  elements.smoothStrength.value = '0.25';
  elements.magnetRadius.value = '10';
  elements.magnetThreshold.value = '35';
  elements.magnetStrength.value = '1.6';

  updateSceneTransform();
  await loadBaseImage();
  syncNetColorFromSelection();
  refreshPathList();
  setTool('select', { save: false, announce: false });
  renderOverlay();
  saveDraft();
  setStatus('Started a new empty project.');
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
  const holeIndex = normalizeSelectedHoleIndex(path, state.anchorDrag.holeIndex);
  const contour = getContourData(path, holeIndex);
  if (!Number.isInteger(index) || !Array.isArray(contour.points) || !contour.points[index]) return;
  state.selectedAnchorIndex = index;
  state.selectedHoleIndex = contour.holeIndex;

  const clampedPoint = [
    clamp(point[0], 0, CANVAS_SIZE),
    clamp(point[1], 0, CANVAS_SIZE),
  ];
  const currentPoint = contour.points[index];
  if (pointDistance2(currentPoint, clampedPoint) < 0.0001) return;

  if (!state.anchorDrag.undoRecorded) {
    recordUndoSnapshot('Move node', { path });
    state.anchorDrag.undoRecorded = true;
  }

  contour.points[index] = clampedPoint;
  if (contour.isHole && Number.isInteger(contour.holeIndex)) {
    if (!Array.isArray(path.holes)) path.holes = [];
    if (!path.holes[contour.holeIndex]) {
      path.holes[contour.holeIndex] = { points: [], pointModes: [] };
    }
    path.holes[contour.holeIndex].points = contour.points;
    path.holes[contour.holeIndex].pointModes = contour.pointModes;
  } else {
    path.points = contour.points;
    path.pointModes = contour.pointModes;
  }

  updatePathGeometry(path);
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

function addViaToDraft(point) {
  if (normalizePathKind(state.tool) !== 'line') return;
  if (!state.drawing) return;
  if (!point) return;
  const via = [
    clamp(point[0], 0, CANVAS_SIZE),
    clamp(point[1], 0, CANVAS_SIZE),
    LINE_VIA_RADIUS,
  ];
  state.drawVias.push(via);
  renderOverlay();
  setStatus(`Added via (${state.drawVias.length}) to current line.`);
}

function bindEvents() {
  elements.toolButtons.forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  if (elements.toolsHelpToggle) {
    elements.toolsHelpToggle.addEventListener('click', () => toggleHelpPanel('tools'));
  }
  if (elements.pathsHelpToggle) {
    elements.pathsHelpToggle.addEventListener('click', () => toggleHelpPanel('paths'));
  }

  [
    elements.netId,
    elements.netLabel,
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

  elements.netId.addEventListener('change', () => {
    const targetKey = normalizeNetKey(elements.netId.value);
    if (!targetKey) return;
    const selected = activePath();
    const selectedUid = selected?.uid || null;
    const sameSideMatch = findNetTemplateOnSide(targetKey, state.side, { excludeUid: selectedUid });
    const otherSide = oppositeSide(state.side);
    const oppositeMatch = findNetTemplateOnSide(targetKey, otherSide);
    const template = sameSideMatch || oppositeMatch;

    if (template?.netLabel && String(template.netLabel).trim().length) {
      elements.netLabel.value = String(template.netLabel).trim();
    }
    if (template?.color && String(template.color).trim().length) {
      elements.color.value = normalizeHexColor(template.color, '#ffe05e');
    }

    const shouldAutoApplyFromOpposite = !sameSideMatch && !!oppositeMatch && !!selected;
    if (shouldAutoApplyFromOpposite) {
      applyMetaToSelected();
      setStatus(`Matched ${targetKey} from ${otherSide}; applied label and color.`);
    }
  });

  elements.color.addEventListener('change', () => {
    applyColorToNet(elements.netId.value, elements.color.value, { save: true, announce: true, recordUndo: true });
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
    syncNetColorFromSelection();
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

  elements.newProject.addEventListener('click', async () => {
    await createNewProject();
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
  elements.openGroups.addEventListener('click', () => {
    openGroupsModal();
  });
  elements.groupsClose.addEventListener('click', () => {
    closeGroupsModal();
  });
  elements.groupsModal.addEventListener('click', (event) => {
    if (event.target === elements.groupsModal) closeGroupsModal();
  });
  elements.groupCreate.addEventListener('click', createGroup);
  elements.groupDelete.addEventListener('click', deleteSelectedGroup);
  elements.groupSave.addEventListener('click', saveSelectedGroupDetails);
  elements.groupName.addEventListener('input', () => {
    applySelectedGroupForm({ save: true, announce: false, rerender: false });
  });
  elements.groupOrder.addEventListener('change', () => {
    applySelectedGroupForm({ save: true, announce: false, rerender: true });
  });
  elements.groupDefaultOn.addEventListener('change', () => {
    applySelectedGroupForm({ save: true, announce: false, rerender: false });
  });
  elements.groupAddNet.addEventListener('click', addNetIdsToSelectedGroup);
  elements.groupRemoveNet.addEventListener('click', removeNetIdsFromSelectedGroup);
  elements.groupsList.addEventListener('change', () => {
    state.selectedGroupId = String(elements.groupsList.value || '');
    renderGroupsModal();
  });

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
  elements.mergePaths.addEventListener('click', mergeSelectedPaths);
  elements.undoEdit.addEventListener('click', () => {
    undoLastEdit({ announce: true });
  });
  elements.toggleBezier.addEventListener('click', toggleBezierSelected);
  elements.resetPathCurves.addEventListener('click', resetSelectedPathCurves);
  elements.simplifyPath.addEventListener('click', simplifySelectedPath);
  elements.smoothPath.addEventListener('click', smoothSelectedPath);
  elements.menuAddNode.addEventListener('click', addNodeFromMenu);
  elements.menuDeleteNode.addEventListener('click', deleteNodeFromMenu);

  elements.pathList.addEventListener('change', () => {
    const selected = Array.from(elements.pathList.selectedOptions)
      .map((option) => option.value)
      .filter(Boolean);
    const uids = normalizeSelectedUids(selected);
    if (!uids.length) {
      state.selectedUids = state.selectedUid ? [state.selectedUid] : [];
      refreshPathList();
      renderOverlay();
      saveDraft();
      return;
    }

    state.selectedUids = uids;
    const nextPrimary = uids.includes(state.selectedUid) ? state.selectedUid : uids[0];
    if (nextPrimary !== state.selectedUid) {
      state.selectedUid = nextPrimary;
      state.selectedAnchorIndex = null;
      state.selectedHoleIndex = null;
    }

    const path = activePath();
    if (path) {
      assignFormDefaults(path);
      ensurePathVisible(path);
    }
    refreshPathList();
    renderOverlay();
    saveDraft();
  });

  elements.overlay.addEventListener('contextmenu', (event) => {
    if (state.tool !== 'select') return;

    const path = activePath();
    if (!path || !Array.isArray(path.points)) return;

    const point = clientToCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const anchor = event.target.closest('[data-anchor-index][data-uid]');
    if (anchor && anchor.dataset.uid === path.uid) {
      event.preventDefault();
      const anchorIndex = parseInt(anchor.dataset.anchorIndex, 10);
      const holeIndexRaw = parseInt(anchor.dataset.holeIndex, 10);
      const holeIndex = Number.isInteger(holeIndexRaw) ? holeIndexRaw : null;
      if (Number.isInteger(anchorIndex)) {
        state.selectedAnchorIndex = anchorIndex;
        state.selectedHoleIndex = normalizeSelectedHoleIndex(path, holeIndex);
        renderOverlay();
        saveDraft();
      }
      showNodeMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        mode: 'anchor',
        anchorIndex: Number.isInteger(anchorIndex) ? anchorIndex : null,
        holeIndex: state.selectedHoleIndex,
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
        holeIndex: state.selectedHoleIndex,
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
      const holeIndexRaw = parseInt(anchor.dataset.holeIndex, 10);
      const holeIndex = Number.isInteger(holeIndexRaw) ? holeIndexRaw : null;
      if (Number.isInteger(anchorIndex)) {
        state.selectedAnchorIndex = anchorIndex;
        const selectedPath = activePath();
        state.selectedHoleIndex = normalizeSelectedHoleIndex(selectedPath, holeIndex);
        renderOverlay();
        saveDraft();
      }
      return;
    }

    const hit = event.target.closest('.net-hit[data-uid]');
    if (hit) {
      state.selectedAnchorIndex = null;
      state.selectedHoleIndex = null;
      selectPath(hit.dataset.uid);
      return;
    }

    state.selectedAnchorIndex = null;
    state.selectedHoleIndex = null;
    ensurePrimarySelection();
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
      const holeIndexRaw = parseInt(anchorTarget.dataset.holeIndex, 10);
      const holeIndex = Number.isInteger(holeIndexRaw) ? holeIndexRaw : null;
      const path = activePath();

      if (path && path.uid === uid && Number.isInteger(index)) {
        state.selectedAnchorIndex = index;
        state.selectedHoleIndex = normalizeSelectedHoleIndex(path, holeIndex);
        state.anchorDrag = {
          uid,
          index,
          holeIndex: state.selectedHoleIndex,
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

    if (state.tool === 'polygon' || state.tool === 'subtract' || state.tool === 'line' || state.tool === 'magnet') {
      if (state.tool === 'subtract') {
        const selectedPath = activePath();
        if (!selectedPath) {
          setStatus('Select an area path first, then draw subtract shape.');
          return;
        }
        if (normalizePathKind(selectedPath.pathKind) === 'line') {
          setStatus('Subtract is only available on area paths.');
          return;
        }
      }
      const point = clientToCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const firstPoint = state.tool === 'magnet' ? magnetSnapPoint(point, null) : point;

      state.drawPoints = [firstPoint];
      state.drawVias = [];
      state.lastPointerPoint = firstPoint;
      state.drawing = {
        pointerId: event.pointerId,
      };

      elements.overlay.setPointerCapture(event.pointerId);
      renderOverlay();
      event.preventDefault();
    }
  });

  elements.overlay.addEventListener('pointermove', (event) => {
    const pointer = clientToCanvasPoint(event.clientX, event.clientY);
    if (pointer) state.lastPointerPoint = pointer;

    if (state.anchorDrag && state.anchorDrag.pointerId === event.pointerId) {
      if (!pointer) return;
      updateDraggedAnchor(pointer);
      return;
    }

    if (state.drawing && state.drawing.pointerId === event.pointerId) {
      if (!pointer) return;
      maybeAppendDrawPoint(pointer);
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
      if (hasActivePointerInteraction() || event.buttons) {
        event.preventDefault();
        return;
      }
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
    event.preventDefault();

    state.panning = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.panX,
      originY: state.panY,
    };

    elements.viewport.setPointerCapture(event.pointerId);
  });

  elements.viewport.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });

  elements.viewport.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
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

  elements.viewport.addEventListener('pointercancel', (event) => {
    if (!state.panning || state.panning.pointerId !== event.pointerId) return;
    state.panning = null;
    elements.viewport.releasePointerCapture(event.pointerId);
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const listFocused = pathListTarget(event.target);
    if (key === 'escape' && groupsModalOpen()) {
      event.preventDefault();
      closeGroupsModal();
      return;
    }
    if (editableTarget(event.target) && !listFocused) return;
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

    if (key === 'v') {
      event.preventDefault();
      setTool('select');
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      setTool('polygon');
      return;
    }
    if (key === 'x') {
      event.preventDefault();
      setTool('subtract');
      return;
    }
    if (key === 'l') {
      event.preventDefault();
      setTool('line');
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      setTool('magnet');
      return;
    }
    if (key === 'h') {
      event.preventDefault();
      setTool('pan');
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      toggleBezierSelected();
      return;
    }
    if (key === 'i') {
      if (listFocused) {
        event.preventDefault();
      }
      if (state.drawing && normalizePathKind(state.tool) === 'line') {
        event.preventDefault();
        const fallback = state.drawPoints[state.drawPoints.length - 1] || null;
        addViaToDraft(state.lastPointerPoint || fallback);
      }
      return;
    }
    if ((key === '[' || key === ']') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      selectAdjacentPath(key === ']' ? 1 : -1);
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      const active = document.activeElement;
      if (!editableTarget(active) || pathListTarget(active)) {
        event.preventDefault();
        deleteSelectedPath();
      }
    }

    if (
      key === 'enter' &&
      (state.tool === 'polygon' || state.tool === 'subtract' || state.tool === 'line' || state.tool === 'magnet') &&
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
      if (state.drawing && state.drawPoints.length > 1) {
        state.drawing = null;
        commitDrawPath();
        return;
      }
      state.drawPoints = [];
      state.drawVias = [];
      state.drawing = null;
      state.anchorDrag = null;
      renderOverlay();
      setStatus('Cancelled current draft action.');
    }

    if ((key === '+' || key === '=') && !event.metaKey && !event.ctrlKey) {
      if (hasActivePointerInteraction()) return;
      event.preventDefault();
      zoomAt(window.innerWidth / 2, window.innerHeight / 2, state.zoom * 1.15);
      saveDraft();
    }

    if (key === '-' && !event.metaKey && !event.ctrlKey) {
      if (hasActivePointerInteraction()) return;
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
  ensureSelectedGroup();
  applyHelpPanels();
  syncNetColorFromSelection();
  setDebugFillOpacity(state.debugFillOpacity, { save: false, announce: false });
  if (state.selectedUid) assignFormDefaults(activePath());

  refreshPathList();
  setTool(state.tool, { save: false, announce: false });
  renderOverlay();

  setStatus(
    restored
      ? 'Editor ready. Restored draft from local storage.'
      : 'Editor ready. Use Polygon, Subtract, Line, or Magnet mode to draw net paths.'
  );
}

init();
