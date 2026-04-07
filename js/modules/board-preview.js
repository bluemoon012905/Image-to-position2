import { runImagePipeline } from "./pipeline.js";
import { buildSgf } from "./sgf.js";

const MANUAL_POINT_COUNT = 4;
const BOARD_COLORS = {
  black: "#111111",
  empty: null,
  white: "#f6f6f1",
};

export function createBoardPreview({
  autoDetectButton,
  boardCanvas,
  boardSizeSelect,
  boardStateSummaryElement,
  clearCornersButton,
  clearStonesButton,
  debugPanelElement,
  debugStageGridElement,
  debugTextElement,
  debugToggleElement,
  editorCanvas,
  exportSgfButton,
  helpElement,
  imageStore,
  manualCornersButton,
  pipelineSummaryElement,
  sgfOutputElement,
  statusElement,
}) {
  const previewContext = boardCanvas.getContext("2d");
  const editorContext = editorCanvas.getContext("2d");
  const state = {
    boardSizeOverride: null,
    debugVisible: false,
    image: null,
    manualCorners: [],
    mode: "idle",
    pipeline: null,
    sgf: "",
    stoneOverrides: new Map(),
    view: null,
  };
  const resizeObserver = new ResizeObserver(() => {
    renderPreview();
    renderEditor();
  });

  resizeObserver.observe(boardCanvas);
  resizeObserver.observe(editorCanvas);
  helpElement.textContent =
    "Auto detection runs in explicit stages. If the board candidate is weak, place four corners clockwise and continue.";

  imageStore.subscribe((snapshot) => {
    state.image = snapshot.image;
    state.manualCorners = [];
    state.mode = snapshot.image ? "detecting" : "idle";
    state.stoneOverrides.clear();
    state.sgf = "";
    sgfOutputElement.value = "";
    pipelineSummaryElement.textContent = snapshot.image
      ? "Running automatic pipeline."
      : "Waiting for an image.";
    void rerunPipeline();
  });

  autoDetectButton.addEventListener("click", () => {
    state.mode = "detecting";
    void rerunPipeline();
  });

  manualCornersButton.addEventListener("click", () => {
    if (!state.image) {
      return;
    }

    state.mode = state.mode === "manual" ? "viewing" : "manual";
    state.manualCorners = [];
    updateStatus();
    renderPreview();
  });

  clearCornersButton.addEventListener("click", () => {
    state.manualCorners = [];
    state.mode = state.image ? "viewing" : "idle";
    void rerunPipeline();
  });

  clearStonesButton.addEventListener("click", () => {
    state.stoneOverrides.clear();
    rebuildSgf();
    renderEditor();
  });

  boardSizeSelect.addEventListener("change", () => {
    state.boardSizeOverride = boardSizeSelect.value === "auto" ? null : Number(boardSizeSelect.value);
    void rerunPipeline();
  });

  exportSgfButton.addEventListener("click", () => {
    rebuildSgf();
  });

  debugToggleElement.addEventListener("change", () => {
    state.debugVisible = debugToggleElement.checked;
    debugPanelElement.hidden = !state.debugVisible;
  });

  boardCanvas.addEventListener("click", (event) => {
    if (state.mode !== "manual" || !state.image || !state.view) {
      return;
    }

    const point = toImagePoint(event, boardCanvas, state.view);

    if (!point) {
      return;
    }

    state.manualCorners.push(point);

    if (state.manualCorners.length >= MANUAL_POINT_COUNT) {
      state.mode = "viewing";
      void rerunPipeline();
    }

    updateStatus();
    renderPreview();
  });

  editorCanvas.addEventListener("click", (event) => {
    if (!state.pipeline?.grid) {
      return;
    }

    const layout = getEditorLayout(editorCanvas, state.pipeline.grid.boardSize);
    const click = toCanvasPoint(event, editorCanvas);
    const hit = findClosestIntersection(layout, click.x, click.y);

    if (!hit || hit.distance > layout.spacing * 0.45) {
      return;
    }

    const key = `${hit.intersection.col},${hit.intersection.row}`;
    const current = getMergedStoneValue(hit.intersection.col, hit.intersection.row);
    const next = cycleStoneValue(current);

    if (next === getAutoStoneValue(hit.intersection.col, hit.intersection.row)) {
      state.stoneOverrides.delete(key);
    } else {
      state.stoneOverrides.set(key, next);
    }

    rebuildSgf();
    renderEditor();
  });

  renderPreview();
  renderEditor();
  updateStatus();

  async function rerunPipeline() {
    if (!state.image) {
      state.pipeline = null;
      updateStatus();
      renderPreview();
      renderEditor();
      renderDebug();
      return;
    }

    state.pipeline = await runImagePipeline({
      boardSizeOverride: state.boardSizeOverride,
      image: state.image,
      manualCorners: state.manualCorners.length === MANUAL_POINT_COUNT ? state.manualCorners : null,
    });

    if (!state.boardSizeOverride && state.pipeline.boardSize.selected) {
      boardSizeSelect.value = "auto";
    }

    if (state.manualCorners.length !== MANUAL_POINT_COUNT && state.pipeline.boardCandidate.confidence < 0.55) {
      state.mode = "manual";
    } else if (state.mode !== "manual") {
      state.mode = "viewing";
    }

    updateStatus();
    rebuildSgf();
    renderPreview();
    renderEditor();
    renderDebug();
  }

  function renderPreview() {
    const width = syncCanvasSize(boardCanvas);
    const height = boardCanvas.height;

    previewContext.clearRect(0, 0, width, height);

    if (!state.image) {
      drawEmptyState(previewContext, width, height, "Upload an image to start.");
      return;
    }

    const view = fitImage(state.image, width, height);
    state.view = view;

    previewContext.save();
    previewContext.drawImage(state.image, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight);
    previewContext.restore();
    drawPreviewShade(previewContext, width, height);

    const displayCorners = getDisplayCorners();

    if (displayCorners?.length) {
      drawCornerOverlay(previewContext, view, displayCorners, state.mode === "manual");
    }

    if (state.pipeline?.grid && displayCorners?.length === 4) {
      drawGridOverlay(previewContext, view, displayCorners, state.pipeline.grid.boardSize);
    }
  }

  function renderEditor() {
    const width = syncCanvasSize(editorCanvas);
    const height = editorCanvas.height;

    editorContext.clearRect(0, 0, width, height);

    if (!state.pipeline?.grid) {
      drawEmptyState(editorContext, width, height, "No board model yet.");
      boardStateSummaryElement.textContent = "No board state yet.";
      return;
    }

    const layout = getEditorLayout(editorCanvas, state.pipeline.grid.boardSize);
    drawBoardEditor(editorContext, layout, getMergedIntersections());
    boardStateSummaryElement.textContent = buildBoardStateSummary();
  }

  function renderDebug() {
    const pipeline = state.pipeline;

    if (!pipeline) {
      debugTextElement.textContent = "No pipeline run yet.";
      debugStageGridElement.replaceChildren();
      return;
    }

    debugTextElement.textContent = formatDebugText(pipeline);
    debugStageGridElement.replaceChildren(...pipeline.stages.map(buildStageCard));
  }

  function rebuildSgf() {
    const boardSize = state.pipeline?.grid?.boardSize ?? state.pipeline?.boardSize?.selected;

    if (!boardSize) {
      state.sgf = "";
      sgfOutputElement.value = "";
      return;
    }

    const stones = getMergedIntersections().filter((intersection) => intersection.value !== "empty");
    state.sgf = buildSgf({ boardSize, stones });
    sgfOutputElement.value = state.sgf;
  }

  function updateStatus() {
    const candidate = state.pipeline?.boardCandidate;
    const boardSize = state.pipeline?.boardSize;

    if (!state.image) {
      statusElement.textContent = "Upload an image to begin automatic detection.";
      statusElement.classList.remove("is-ready", "is-manual");
      pipelineSummaryElement.textContent = "Waiting for an image.";
      return;
    }

    if (state.mode === "manual" && state.manualCorners.length < MANUAL_POINT_COUNT) {
      statusElement.textContent =
        `Manual corner mode. ${MANUAL_POINT_COUNT - state.manualCorners.length} corners remaining.`;
      statusElement.classList.add("is-manual");
      statusElement.classList.remove("is-ready");
      pipelineSummaryElement.textContent = "Automatic board candidate is weak. Manual corner confirmation is active.";
      return;
    }

    statusElement.classList.remove("is-manual");
    statusElement.classList.toggle("is-ready", Boolean(candidate?.corners));
    statusElement.textContent = candidate?.reason ?? "Running automatic pipeline.";
    pipelineSummaryElement.textContent = [
      candidate ? `Board confidence ${Math.round(candidate.confidence * 100)}%.` : null,
      boardSize?.selected ? `Board size ${boardSize.selected}x${boardSize.selected}.` : null,
      boardSize?.reason ?? null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function getDisplayCorners() {
    if (state.manualCorners.length) {
      return state.manualCorners;
    }

    if (!state.pipeline?.boardCandidate?.corners) {
      return null;
    }

    return state.pipeline.boardCandidate.corners.map((corner) => ({
      x: corner.x * state.pipeline.preprocess.scale,
      y: corner.y * state.pipeline.preprocess.scale,
    }));
  }

  function getAutoStoneValue(col, row) {
    const intersection = state.pipeline?.stones?.intersections.find((item) => item.col === col && item.row === row);

    return intersection?.value ?? "empty";
  }

  function getMergedStoneValue(col, row) {
    const key = `${col},${row}`;

    if (state.stoneOverrides.has(key)) {
      return state.stoneOverrides.get(key);
    }

    return getAutoStoneValue(col, row);
  }

  function getMergedIntersections() {
    return (state.pipeline?.grid?.intersections ?? []).map((intersection) => ({
      ...intersection,
      value: getMergedStoneValue(intersection.col, intersection.row),
    }));
  }

  function buildBoardStateSummary() {
    const stones = getMergedIntersections();
    const counts = { black: 0, empty: 0, white: 0 };

    for (const stone of stones) {
      counts[stone.value] += 1;
    }

    return `${state.pipeline.grid.boardSize}x${state.pipeline.grid.boardSize} board. ${counts.black} black, ${counts.white} white, ${counts.empty} empty. ${state.stoneOverrides.size} manual overrides.`;
  }
}

function buildStageCard(stage) {
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  const caption = document.createElement("figcaption");

  figure.className = "debug-stage";
  image.className = "debug-stage__image";
  image.alt = stage.label;
  image.src = stage.url;
  caption.className = "debug-stage__label";
  caption.textContent = stage.label;
  figure.append(image, caption);

  return figure;
}

function formatDebugText(pipeline) {
  const boardCandidate = pipeline.boardCandidate;
  const boardSize = pipeline.boardSize;
  const stoneCounts = pipeline.stones.counts;

  return [
    `boardCandidate: mode=${boardCandidate.mode} confidence=${Math.round(boardCandidate.confidence * 100)}%`,
    `boardReason: ${boardCandidate.reason}`,
    `boardSize: selected=${boardSize.selected ?? "n/a"} confidence=${Math.round(boardSize.confidence * 100)}%`,
    `boardSizeReason: ${boardSize.reason}`,
    `stoneCounts: black=${stoneCounts.black} white=${stoneCounts.white} empty=${stoneCounts.empty}`,
    boardSize.scores?.length
      ? `boardSizeScores: ${boardSize.scores.map((entry) => `${entry.size}:${entry.score.toFixed(3)}`).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function syncCanvasSize(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
  const height = Math.max(1, Math.round(bounds.height * devicePixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return width;
}

function drawEmptyState(context, width, height, message) {
  context.save();
  context.fillStyle = "rgba(255, 250, 241, 0.92)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(105, 91, 73, 0.92)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${Math.max(18, width * 0.024)}px Avenir Next, Segoe UI, sans-serif`;
  context.fillText(message, width / 2, height / 2);
  context.restore();
}

function drawPreviewShade(context, width, height) {
  context.save();
  context.fillStyle = "rgba(31, 26, 20, 0.05)";
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawCornerOverlay(context, view, corners, manual) {
  context.save();
  context.strokeStyle = manual ? "#8a531b" : "#2e7d50";
  context.fillStyle = manual ? "#b56a2d" : "#2e7d50";
  context.lineWidth = Math.max(2, view.scale * 4);

  context.beginPath();
  corners.forEach((corner, index) => {
    const x = view.offsetX + corner.x * view.scale;
    const y = view.offsetY + corner.y * view.scale;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  if (corners.length === 4) {
    context.closePath();
  }

  context.stroke();

  corners.forEach((corner, index) => {
    const x = view.offsetX + corner.x * view.scale;
    const y = view.offsetY + corner.y * view.scale;

    context.beginPath();
    context.arc(x, y, Math.max(6, view.scale * 7), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = `${Math.max(11, view.scale * 14)}px Avenir Next, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), x, y + 0.5);
    context.fillStyle = manual ? "#b56a2d" : "#2e7d50";
  });

  context.restore();
}

function drawGridOverlay(context, view, corners, boardSize) {
  context.save();
  context.strokeStyle = "rgba(46, 125, 80, 0.4)";
  context.fillStyle = "rgba(46, 125, 80, 0.5)";
  context.lineWidth = 1.2;

  for (let row = 0; row < boardSize; row += 1) {
    const t = boardSize === 1 ? 0 : row / (boardSize - 1);
    const start = interpolateQuad(corners, 0, t);
    const end = interpolateQuad(corners, 1, t);
    drawLine(context, view, start, end);
  }

  for (let col = 0; col < boardSize; col += 1) {
    const t = boardSize === 1 ? 0 : col / (boardSize - 1);
    const start = interpolateQuad(corners, t, 0);
    const end = interpolateQuad(corners, t, 1);
    drawLine(context, view, start, end);
  }

  context.restore();
}

function drawLine(context, view, start, end) {
  context.beginPath();
  context.moveTo(view.offsetX + start.x * view.scale, view.offsetY + start.y * view.scale);
  context.lineTo(view.offsetX + end.x * view.scale, view.offsetY + end.y * view.scale);
  context.stroke();
}

function drawBoardEditor(context, layout, intersections) {
  context.save();
  context.fillStyle = "#d9af61";
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.fillRect(layout.margin * 0.35, layout.margin * 0.35, layout.width - layout.margin * 0.7, layout.height - layout.margin * 0.7);
  context.strokeStyle = "#33200f";
  context.lineWidth = Math.max(1, layout.spacing * 0.05);

  for (let index = 0; index < layout.boardSize; index += 1) {
    const position = layout.margin + index * layout.spacing;
    context.beginPath();
    context.moveTo(layout.margin, position);
    context.lineTo(layout.width - layout.margin, position);
    context.stroke();

    context.beginPath();
    context.moveTo(position, layout.margin);
    context.lineTo(position, layout.height - layout.margin);
    context.stroke();
  }

  for (const point of starPoints(layout.boardSize)) {
    const x = layout.margin + point.col * layout.spacing;
    const y = layout.margin + point.row * layout.spacing;
    context.beginPath();
    context.arc(x, y, Math.max(2.5, layout.spacing * 0.08), 0, Math.PI * 2);
    context.fillStyle = "#33200f";
    context.fill();
  }

  for (const intersection of intersections) {
    const x = layout.margin + intersection.col * layout.spacing;
    const y = layout.margin + intersection.row * layout.spacing;

    if (intersection.value === "empty") {
      continue;
    }

    context.beginPath();
    context.arc(x, y, layout.spacing * 0.42, 0, Math.PI * 2);
    context.fillStyle = BOARD_COLORS[intersection.value];
    context.fill();
    context.strokeStyle = intersection.value === "white" ? "#9b8b76" : "#000000";
    context.lineWidth = Math.max(1, layout.spacing * 0.04);
    context.stroke();
  }

  context.restore();
}

function fitImage(image, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);

  return {
    drawHeight: image.naturalHeight * scale,
    drawWidth: image.naturalWidth * scale,
    offsetX: (width - image.naturalWidth * scale) / 2,
    offsetY: (height - image.naturalHeight * scale) / 2,
    scale,
  };
}

function toImagePoint(event, canvas, view) {
  const point = toCanvasPoint(event, canvas);

  if (
    point.x < view.offsetX ||
    point.x > view.offsetX + view.drawWidth ||
    point.y < view.offsetY ||
    point.y > view.offsetY + view.drawHeight
  ) {
    return null;
  }

  return {
    x: (point.x - view.offsetX) / view.scale,
    y: (point.y - view.offsetY) / view.scale,
  };
}

function toCanvasPoint(event, canvas) {
  const bounds = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
    y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
  };
}

function getEditorLayout(canvas, boardSize) {
  const width = canvas.width;
  const height = canvas.height;
  const size = Math.min(width, height);
  const margin = size * 0.1;
  const spacing = (size - margin * 2) / Math.max(boardSize - 1, 1);

  return {
    boardSize,
    height: size,
    margin,
    spacing,
    width: size,
  };
}

function findClosestIntersection(layout, x, y) {
  let best = null;

  for (let row = 0; row < layout.boardSize; row += 1) {
    for (let col = 0; col < layout.boardSize; col += 1) {
      const pointX = layout.margin + col * layout.spacing;
      const pointY = layout.margin + row * layout.spacing;
      const distance = Math.hypot(pointX - x, pointY - y);

      if (!best || distance < best.distance) {
        best = {
          distance,
          intersection: { col, row },
        };
      }
    }
  }

  return best;
}

function interpolateQuad(corners, u, v) {
  const top = lerpPoint(corners[0], corners[1], u);
  const bottom = lerpPoint(corners[3], corners[2], u);

  return lerpPoint(top, bottom, v);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function cycleStoneValue(value) {
  if (value === "empty") {
    return "black";
  }

  if (value === "black") {
    return "white";
  }

  return "empty";
}

function starPoints(boardSize) {
  if (boardSize === 9) {
    return [
      { col: 2, row: 2 },
      { col: 2, row: 6 },
      { col: 6, row: 2 },
      { col: 6, row: 6 },
      { col: 4, row: 4 },
    ];
  }

  if (boardSize === 13) {
    return [
      { col: 3, row: 3 },
      { col: 3, row: 6 },
      { col: 3, row: 9 },
      { col: 6, row: 3 },
      { col: 6, row: 6 },
      { col: 6, row: 9 },
      { col: 9, row: 3 },
      { col: 9, row: 6 },
      { col: 9, row: 9 },
    ];
  }

  return [
    { col: 3, row: 3 },
    { col: 3, row: 9 },
    { col: 3, row: 15 },
    { col: 9, row: 3 },
    { col: 9, row: 9 },
    { col: 9, row: 15 },
    { col: 15, row: 3 },
    { col: 15, row: 9 },
    { col: 15, row: 15 },
  ];
}
