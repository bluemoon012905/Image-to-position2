import { detectBoardOutline } from "./board-detector.js";

const MANUAL_POINT_COUNT = 4;

export function createBoardPreview({
  autoDetectButton,
  boardCanvas,
  debugElement,
  helpElement,
  imageStore,
  manualDrawButton,
  resetOutlineButton,
  statusElement,
  summaryElement,
}) {
  const context = boardCanvas.getContext("2d");
  const state = {
    detection: null,
    image: null,
    manualCorners: [],
    mode: "idle",
    renderCorners: null,
    renderRect: null,
    view: null,
  };
  const resizeObserver = new ResizeObserver(() => {
    renderScene();
  });

  resizeObserver.observe(boardCanvas);

  imageStore.subscribe(async (snapshot) => {
    state.image = snapshot.image;
    state.detection = null;
    state.manualCorners = [];
    state.renderCorners = null;
    state.renderRect = null;
    state.mode = snapshot.image ? "detecting" : "idle";
    updateControls();

    if (!snapshot.image) {
      setStatus("Upload an image to start board detection.", "default");
      summaryElement.textContent = "No board outline detected yet.";
      debugElement.textContent = "No detection debug yet.";
      renderScene();
      return;
    }

    setStatus("Scanning for repeated grid lines.", "default");
    summaryElement.textContent = "Running automatic board detection.";
    renderScene();
    await runAutoDetect();
  });

  autoDetectButton.addEventListener("click", () => {
    void runAutoDetect();
  });

  manualDrawButton.addEventListener("click", () => {
    if (!state.image) {
      return;
    }

    const nextMode = state.mode === "manual" ? "viewing" : "manual";
    state.mode = nextMode;
    state.manualCorners = [];
    state.renderCorners = state.detection?.corners ?? null;
    state.renderRect = null;

    if (nextMode === "manual") {
      setStatus("Manual mode active. Click the four board corners clockwise.", "manual");
      summaryElement.textContent = "Manual board outline in progress.";
    } else if (state.detection) {
      setStatus("Automatic outline restored.", "ready");
      summaryElement.textContent = buildSummary("Auto outline ready.", state.detection);
    } else {
      setStatus("Choose auto detect or place four manual corners.", "default");
      summaryElement.textContent = "No board outline detected yet.";
    }

    updateControls();
    renderScene();
  });

  resetOutlineButton.addEventListener("click", () => {
    state.manualCorners = [];
    state.renderCorners = null;
    state.renderRect = null;
    state.detection = null;
    state.mode = state.image ? "viewing" : "idle";
    summaryElement.textContent = "No board outline detected yet.";
    setStatus(
      state.image
        ? "Outline reset. Run auto detect or enter manual mode."
        : "Upload an image to start board detection.",
      "default",
    );
    updateControls();
    renderScene();
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
    state.renderCorners = state.manualCorners.slice();
    renderScene();

    if (state.manualCorners.length < MANUAL_POINT_COUNT) {
      setStatus(
        `Manual mode active. ${MANUAL_POINT_COUNT - state.manualCorners.length} corners remaining.`,
        "manual",
      );
      summaryElement.textContent = "Manual board outline in progress.";
      return;
    }

    state.mode = "viewing";
    state.renderCorners = state.manualCorners.slice();
    setStatus("Manual board outline captured.", "ready");
    summaryElement.textContent = `Manual outline ready with ${MANUAL_POINT_COUNT} corners.`;
    updateControls();
    renderScene();
  });

  helpElement.textContent =
    "Auto detect scans for repeated grid lines and expands outward. Manual mode lets you place the four board corners yourself.";

  updateControls();
  renderScene();

  async function runAutoDetect() {
    if (!state.image) {
      return;
    }

    state.mode = "detecting";
    state.manualCorners = [];
    state.renderCorners = null;
    state.renderRect = null;
    updateControls();
    setStatus("Scanning for repeated grid lines.", "default");
    summaryElement.textContent = "Running automatic board detection.";
    renderScene();

    const detection = await detectBoardOutline(state.image);

    if (!state.image) {
      return;
    }

    if (!detection.corners) {
      state.detection = null;
      state.mode = "viewing";
      state.renderCorners = null;
      state.renderRect = null;
      setStatus(detection.status, "default");
      summaryElement.textContent = "Auto detection could not confirm a board outline.";
      debugElement.textContent = formatDetectionDebug(detection);
      updateControls();
      renderScene();
      return;
    }

    state.detection = detection;
    state.mode = "animating";
    summaryElement.textContent = buildSummary("Auto outline ready.", detection);
    debugElement.textContent = formatDetectionDebug(detection);
    await playExpansionPreview(detection.expansionSteps);
    state.renderRect = null;
    state.renderCorners = detection.corners;
    state.mode = "viewing";
    setStatus(detection.status, "ready");
    updateControls();
    renderScene();
  }

  async function playExpansionPreview(steps) {
    if (!steps?.length) {
      return;
    }

    for (const step of steps) {
      state.renderRect = step;
      renderScene();
      await wait(80);
    }
  }

  function renderScene() {
    const bounds = boardCanvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
    const height = Math.max(1, Math.round(bounds.height * devicePixelRatio));

    if (boardCanvas.width !== width || boardCanvas.height !== height) {
      boardCanvas.width = width;
      boardCanvas.height = height;
    }

    context.clearRect(0, 0, width, height);

    if (!state.image) {
      drawEmptyState(width, height);
      return;
    }

    const view = fitImage(state.image, width, height);
    state.view = view;

    context.save();
    context.drawImage(state.image, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight);
    context.restore();

    drawShade(width, height);

    if (state.renderRect) {
      drawRect(state.renderRect, view, "rgba(181, 106, 45, 0.95)");
    }

    if (state.renderCorners?.length) {
      drawCorners(state.renderCorners, view, state.mode === "manual");
    }

    if (state.detection?.debug) {
      drawGridHints(state.detection.debug, view);
    }
  }

  function updateControls() {
    const hasImage = Boolean(state.image);

    autoDetectButton.disabled = !hasImage || state.mode === "detecting" || state.mode === "animating";
    manualDrawButton.disabled = !hasImage || state.mode === "detecting" || state.mode === "animating";
    resetOutlineButton.disabled = !hasImage;
    manualDrawButton.classList.toggle("is-active", state.mode === "manual");
  }

  function setStatus(message, tone) {
    statusElement.textContent = message;
    statusElement.classList.remove("is-ready", "is-manual");

    if (tone === "ready") {
      statusElement.classList.add("is-ready");
    }

    if (tone === "manual") {
      statusElement.classList.add("is-manual");
    }
  }

  function drawEmptyState(width, height) {
    context.save();
    context.fillStyle = "rgba(255, 250, 241, 0.92)";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(105, 91, 73, 0.92)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.max(18, width * 0.022)}px Avenir Next, Segoe UI, sans-serif`;
    context.fillText("Board preview will appear here", width / 2, height / 2 - 14);
    context.font = `${Math.max(13, width * 0.014)}px Avenir Next, Segoe UI, sans-serif`;
    context.fillText("Upload or paste an image to begin.", width / 2, height / 2 + 22);
    context.restore();
  }

  function drawShade(width, height) {
    context.save();
    context.fillStyle = "rgba(31, 26, 20, 0.05)";
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  function drawRect(rect, view, strokeStyle) {
    const left = view.offsetX + rect.left * view.scale;
    const top = view.offsetY + rect.top * view.scale;
    const right = view.offsetX + rect.right * view.scale;
    const bottom = view.offsetY + rect.bottom * view.scale;

    context.save();
    context.strokeStyle = strokeStyle;
    context.lineWidth = Math.max(2, view.scale * 4);
    context.setLineDash([10, 10]);
    context.strokeRect(left, top, right - left, bottom - top);
    context.restore();
  }

  function drawCorners(corners, view, isManual) {
    context.save();
    context.strokeStyle = isManual ? "#7b4d21" : "#2e7d50";
    context.fillStyle = isManual ? "#b56a2d" : "#2e7d50";
    context.lineWidth = Math.max(2, view.scale * 4);

    if (corners.length >= 2) {
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

      if (corners.length === MANUAL_POINT_COUNT) {
        context.closePath();
      }

      context.stroke();
    }

    corners.forEach((corner, index) => {
      const x = view.offsetX + corner.x * view.scale;
      const y = view.offsetY + corner.y * view.scale;

      context.beginPath();
      context.arc(x, y, Math.max(5, view.scale * 7), 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "white";
      context.font = `${Math.max(11, view.scale * 14)}px Avenir Next, Segoe UI, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), x, y + 0.5);
      context.fillStyle = isManual ? "#b56a2d" : "#2e7d50";
    });

    context.restore();
  }

  function drawGridHints(debug, view) {
    context.save();
    context.strokeStyle = "rgba(46, 125, 80, 0.25)";
    context.lineWidth = 1;

    debug.xLines.forEach((x) => {
      const canvasX = view.offsetX + x * view.scale;
      context.beginPath();
      context.moveTo(canvasX, view.offsetY);
      context.lineTo(canvasX, view.offsetY + view.drawHeight);
      context.stroke();
    });

    debug.yLines.forEach((y) => {
      const canvasY = view.offsetY + y * view.scale;
      context.beginPath();
      context.moveTo(view.offsetX, canvasY);
      context.lineTo(view.offsetX + view.drawWidth, canvasY);
      context.stroke();
    });

    context.restore();
  }
}

function fitImage(image, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;

  return {
    drawHeight,
    drawWidth,
    offsetX: (width - drawWidth) / 2,
    offsetY: (height - drawHeight) / 2,
    scale,
  };
}

function toImagePoint(event, canvas, view) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (canvas.width / bounds.width);
  const y = (event.clientY - bounds.top) * (canvas.height / bounds.height);

  if (
    x < view.offsetX ||
    x > view.offsetX + view.drawWidth ||
    y < view.offsetY ||
    y > view.offsetY + view.drawHeight
  ) {
    return null;
  }

  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}

function buildSummary(prefix, detection) {
  const confidence = Math.round(detection.confidence * 100);
  return `${prefix} Confidence ${confidence}%.`;
}

function formatDetectionDebug(detection) {
  if (!detection?.debugMeta) {
    return detection?.status ?? "No detection debug yet.";
  }

  const { bounds, failure, xAxis, xGrid, yAxis, yGrid } = detection.debugMeta;

  if (failure) {
    return [
      `status: ${detection.status}`,
      `confidence: ${Math.round(detection.confidence * 100)}%`,
      formatAxisDebug("xAxis", xAxis),
      formatAxisDebug("yAxis", yAxis),
    ].join("\n\n");
  }

  return [
    `status: ${detection.status}`,
    `confidence: ${Math.round(detection.confidence * 100)}%`,
    `bounds: left=${round(bounds.left)} top=${round(bounds.top)} right=${round(bounds.right)} bottom=${round(bounds.bottom)}`,
    `xGrid: count=${xGrid.lineCount} spacing=${round(xGrid.spacing)} start=${round(xGrid.start)} end=${round(xGrid.end)}`,
    `xLines: ${xGrid.lines.map((value) => round(value)).join(", ")}`,
    formatAxisDebug("xAxis", xAxis),
    `yGrid: count=${yGrid.lineCount} spacing=${round(yGrid.spacing)} start=${round(yGrid.start)} end=${round(yGrid.end)}`,
    `yLines: ${yGrid.lines.map((value) => round(value)).join(", ")}`,
    formatAxisDebug("yAxis", yAxis),
  ].join("\n");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function formatAxisDebug(label, axis) {
  if (!axis) {
    return `${label}: none`;
  }

  const lines = [
    `${label}: spacing=${axis.spacing ?? "n/a"} coverage=${axis.coverage ?? "n/a"}`,
    `${label} peaks: ${
      axis.clusters?.length
        ? axis.clusters.map((cluster) => cluster.position).join(", ")
        : "none"
    }`,
    `${label} run: ${
      axis.run
        ? `${axis.run.positions.join(", ")} (observed=${axis.run.observedLines})`
        : "none"
    }`,
  ];

  if (axis.rejectedMarginCandidates?.length) {
    lines.push(
      `${label} rejected: ${axis.rejectedMarginCandidates
        .map(
          (candidate) =>
            `${candidate.path}:${candidate.lineCount}[${candidate.firstMargin}/${candidate.lastMargin}]`,
        )
        .join(" | ")}`,
    );
  }

  return lines.join("\n");
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}
