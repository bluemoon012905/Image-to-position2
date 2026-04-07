# Grid Scan Functions

These are the current grid-scan-specific functions extracted from [js/vision.js](/home/bluey/personal/Image-to-position/js/vision.js).

## Included functions

- `collectLineSegments`
- `clusterBoundaryLines`
- `pickBoundaryPair`
- `adjacentClusterSpacing`
- `findBestGridRun`
- `intersectBoundaryLines`
- `linesForDebug`
- `buildRunFrames`
- `buildDetectionDebugFrames`
- `detectGridFrameQuad`
- `autoDetectCorners`

## Notes

- These functions still depend on shared helpers and globals from the app, including `median`, `orderedCorners`, `clampOriginalPoint`, `polygonArea`, `extractEdgeFeaturePoints`, `refineCornersByQuadrants`, `expandCornersOutward`, `originalToCanvas`, `drawSourceImage`, `setStatus`, `playDetectionReplay`, `state`, `cv`, and `cornerStatus`.
- `autoDetectCorners()` is the entry point for the board-lock flow.

```js
function collectLineSegments(edges, width, height) {
  if (typeof cv.HoughLinesP !== "function") {
    return [];
  }

  const lines = new cv.Mat();
  const segments = [];
  const minDim = Math.min(width, height);
  cv.HoughLinesP(
    edges,
    lines,
    1,
    Math.PI / 180,
    70,
    Math.max(28, Math.round(minDim * 0.12)),
    Math.max(10, Math.round(minDim * 0.03))
  );

  for (let i = 0; i < lines.rows; i += 1) {
    const base = i * 4;
    const x1 = lines.data32S[base];
    const y1 = lines.data32S[base + 1];
    const x2 = lines.data32S[base + 2];
    const y2 = lines.data32S[base + 3];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < Math.max(22, minDim * 0.08)) continue;
    segments.push({ x1, y1, x2, y2, dx, dy, length });
  }

  lines.delete();
  return segments;
}

function clusterBoundaryLines(lines, interceptTolerance) {
  if (!lines.length) return [];

  const sorted = [...lines].sort((a, b) => a.intercept - b.intercept);
  const clusters = [];

  for (const line of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(line.intercept - last.intercept) > interceptTolerance) {
      clusters.push({
        interceptWeighted: line.intercept * line.length,
        slopeWeighted: line.slope * line.length,
        totalLength: line.length,
        lineCount: 1,
        minAlong: Math.min(line.alongA, line.alongB),
        maxAlong: Math.max(line.alongA, line.alongB),
      });
      continue;
    }

    last.interceptWeighted += line.intercept * line.length;
    last.slopeWeighted += line.slope * line.length;
    last.totalLength += line.length;
    last.lineCount += 1;
    last.minAlong = Math.min(last.minAlong, line.alongA, line.alongB);
    last.maxAlong = Math.max(last.maxAlong, line.alongA, line.alongB);
  }

  return clusters.map((cluster) => ({
    intercept: cluster.interceptWeighted / Math.max(1, cluster.totalLength),
    slope: cluster.slopeWeighted / Math.max(1, cluster.totalLength),
    totalLength: cluster.totalLength,
    lineCount: cluster.lineCount,
    span: cluster.maxAlong - cluster.minAlong,
  }));
}

function pickBoundaryPair(clusters, minCoverage) {
  const eligible = clusters
    .filter((cluster) => cluster.span >= minCoverage)
    .sort((a, b) => a.intercept - b.intercept);

  if (eligible.length < 2) return null;
  return {
    first: eligible[0],
    last: eligible[eligible.length - 1],
    all: eligible,
  };
}

function adjacentClusterSpacing(clusters) {
  if (!clusters || clusters.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < clusters.length; i += 1) {
    const diff = clusters[i].intercept - clusters[i - 1].intercept;
    if (diff > 3) {
      diffs.push(diff);
    }
  }
  return diffs.length ? median(diffs) : 0;
}

function findBestGridRun(clusters, minCoverage) {
  const eligible = clusters
    .filter((cluster) => cluster.span >= minCoverage)
    .sort((a, b) => a.intercept - b.intercept);
  if (eligible.length < 4) return null;

  const spacing = adjacentClusterSpacing(eligible);
  if (!spacing || !Number.isFinite(spacing)) return null;

  const tolerance = Math.max(4, spacing * 0.28);
  let best = null;

  for (let start = 0; start < eligible.length; start += 1) {
    const run = [eligible[start]];
    let totalLength = eligible[start].totalLength;
    let gaps = 0;

    for (let i = start + 1; i < eligible.length; i += 1) {
      const prev = run[run.length - 1];
      const next = eligible[i];
      const diff = next.intercept - prev.intercept;
      const steps = Math.max(1, Math.round(diff / spacing));
      const expected = steps * spacing;

      if (steps > 3 || Math.abs(diff - expected) > tolerance * steps) {
        if (diff > spacing * 3.5) {
          break;
        }
        continue;
      }

      run.push(next);
      totalLength += next.totalLength;
      gaps += Math.max(0, steps - 1);
    }

    if (run.length < 4) continue;
    const first = run[0];
    const last = run[run.length - 1];
    const coveredSpan = last.intercept - first.intercept;
    const score = run.length * 20 + totalLength * 0.015 - gaps * 6 + coveredSpan * 0.02;

    if (!best || score > best.score) {
      best = {
        spacing,
        tolerance,
        run,
        first,
        last,
        observedLines: run.length,
        coveredSpan,
        gaps,
        totalLength,
        score,
      };
    }
  }

  return best;
}

function intersectBoundaryLines(vertical, horizontal) {
  const denom = 1 - vertical.slope * horizontal.slope;
  if (Math.abs(denom) < 1e-5) return null;
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denom;
  const y = horizontal.slope * x + horizontal.intercept;
  return { x, y };
}

function linesForDebug(clusters, axis, color, width = 1.8, dash = [8, 6]) {
  return (clusters || []).map((cluster) => ({
    axis,
    intercept: cluster.intercept,
    slope: cluster.slope,
    color,
    width,
    dash,
  }));
}

function buildRunFrames(run, axis, color, titlePrefix) {
  if (!run?.run?.length) return [];
  const frames = [];
  const acc = [];
  for (let i = 0; i < run.run.length; i += 1) {
    const cluster = run.run[i];
    acc.push({
      axis,
      intercept: cluster.intercept,
      slope: cluster.slope,
      color,
      width: 2.8,
      dash: [],
    });
    frames.push({
      label: `${titlePrefix}: ${i + 1} line${i === 0 ? "" : "s"} in evenly spaced run`,
      lines: [...acc],
      duration: 420,
    });
  }
  return frames;
}

function buildDetectionDebugFrames(lineCandidate) {
  const frames = [];
  const debug = lineCandidate?.debug;

  if (debug?.verticalClusters?.length) {
    frames.push({
      label: `Grid scan: detected ${debug.verticalClusters.length} vertical line families`,
      lines: linesForDebug(debug.verticalClusters, "vertical", "rgba(196, 56, 56, 0.55)", 1.6, [6, 8]),
      duration: 520,
    });
  }

  if (debug?.verticalRun) {
    frames.push(
      ...buildRunFrames(
        debug.verticalRun,
        "vertical",
        "rgba(196, 56, 56, 0.95)",
        "Grid scan: expanding vertical run"
      )
    );
  }

  if (debug?.horizontalClusters?.length) {
    frames.push({
      label: `Grid scan: detected ${debug.horizontalClusters.length} horizontal line families`,
      lines: linesForDebug(debug.horizontalClusters, "horizontal", "rgba(196, 56, 56, 0.55)", 1.6, [6, 8]),
      duration: 520,
    });
  }

  if (debug?.horizontalRun) {
    frames.push(
      ...buildRunFrames(
        debug.horizontalRun,
        "horizontal",
        "rgba(196, 56, 56, 0.95)",
        "Grid scan: expanding horizontal run"
      )
    );
  }

  if (lineCandidate?.points) {
    frames.push({
      label: "Grid scan selected for board warp",
      quads: [{ points: lineCandidate.points, color: "rgba(196, 56, 56, 0.95)", width: 2.6 }],
      duration: 900,
    });
  }

  return frames;
}

function detectGridFrameQuad(edges, width, height) {
  const segments = collectLineSegments(edges, width, height);
  if (!segments.length) return null;

  const centerX = width / 2;
  const centerY = height / 2;
  const verticalLines = [];
  const horizontalLines = [];

  for (const segment of segments) {
    const angle = (Math.atan2(segment.dy, segment.dx) * 180) / Math.PI;
    const absAngle = Math.abs(angle);

    if (Math.abs(absAngle - 90) <= 18) {
      const slope = segment.dy === 0 ? 0 : segment.dx / segment.dy;
      const intercept = ((segment.x1 - slope * segment.y1) + (segment.x2 - slope * segment.y2)) / 2;
      verticalLines.push({
        intercept,
        slope,
        length: segment.length,
        alongA: segment.y1,
        alongB: segment.y2,
      });
    } else if (absAngle <= 18 || absAngle >= 162) {
      const slope = segment.dx === 0 ? 0 : segment.dy / segment.dx;
      const intercept = ((segment.y1 - slope * segment.x1) + (segment.y2 - slope * segment.x2)) / 2;
      horizontalLines.push({
        intercept,
        slope,
        length: segment.length,
        alongA: segment.x1,
        alongB: segment.x2,
      });
    }
  }

  const verticalClusters = clusterBoundaryLines(verticalLines, Math.max(8, width * 0.012));
  const horizontalClusters = clusterBoundaryLines(horizontalLines, Math.max(8, height * 0.012));
  const verticalRun = findBestGridRun(verticalClusters, height * 0.22);
  const horizontalRun = findBestGridRun(horizontalClusters, width * 0.22);
  const verticalPair = pickBoundaryPair(verticalClusters, height * 0.22);
  const horizontalPair = pickBoundaryPair(horizontalClusters, width * 0.22);

  const verticalSource = verticalRun || verticalPair;
  const horizontalSource = horizontalRun || horizontalPair;
  if (!verticalSource || !horizontalSource) return null;

  const leftLine = {
    intercept: verticalSource.first.intercept,
    slope: verticalSource.first.slope,
  };
  const rightLine = {
    intercept: verticalSource.last.intercept,
    slope: verticalSource.last.slope,
  };
  const topLine = {
    intercept: horizontalSource.first.intercept,
    slope: horizontalSource.first.slope,
  };
  const bottomLine = {
    intercept: horizontalSource.last.intercept,
    slope: horizontalSource.last.slope,
  };

  const corners = [
    intersectBoundaryLines(leftLine, topLine),
    intersectBoundaryLines(rightLine, topLine),
    intersectBoundaryLines(rightLine, bottomLine),
    intersectBoundaryLines(leftLine, bottomLine),
  ];

  if (corners.some((point) => !point)) {
    return null;
  }

  const clampedCorners = corners.map((point) => clampOriginalPoint(point, width, height));
  const area = polygonArea(clampedCorners);
  return {
    points: orderedCorners(clampedCorners),
    meta: {
      area,
      areaRatio: area / Math.max(1, width * height),
      verticalClusters: verticalPair?.all?.length || 0,
      horizontalClusters: horizontalPair?.all?.length || 0,
      verticalSpacing: Number(
        (verticalRun?.spacing || adjacentClusterSpacing(verticalPair?.all || []) || 0).toFixed(2)
      ),
      horizontalSpacing: Number(
        (horizontalRun?.spacing || adjacentClusterSpacing(horizontalPair?.all || []) || 0).toFixed(2)
      ),
      visibleVerticalLines: verticalRun?.observedLines || 0,
      visibleHorizontalLines: horizontalRun?.observedLines || 0,
      verticalGaps: verticalRun?.gaps || 0,
      horizontalGaps: horizontalRun?.gaps || 0,
      anchorX: Number(centerX.toFixed(1)),
      anchorY: Number(centerY.toFixed(1)),
    },
    debug: {
      verticalClusters,
      horizontalClusters,
      verticalRun,
      horizontalRun,
    },
  };
}

function autoDetectCorners(options = {}) {
  const { suppressStatus = false } = options;
  if (!state.cvReady || !state.image) {
    if (!suppressStatus) {
      setStatus(cornerStatus, "OpenCV not ready or image not loaded.");
    }
    return false;
  }

  const src = cv.imread(state.image);
  const gray = new cv.Mat();
  const denoised = new cv.Mat();
  const contrasted = new cv.Mat();
  const edgesRaw = new cv.Mat();
  const edges = new cv.Mat();
  const morphKernel = cv.Mat.ones(3, 3, cv.CV_8U);

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.bilateralFilter(gray, denoised, 9, 75, 75, cv.BORDER_DEFAULT);
  if (typeof cv.createCLAHE === "function") {
    const clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(denoised, contrasted);
    clahe.delete();
  } else {
    denoised.copyTo(contrasted);
  }
  cv.Canny(contrasted, edgesRaw, 45, 140);
  cv.morphologyEx(edgesRaw, edges, cv.MORPH_CLOSE, morphKernel);
  cv.dilate(edges, edges, morphKernel, new cv.Point(-1, -1), 1);
  const lineCandidate = detectGridFrameQuad(edges, src.cols, src.rows);
  const chosen = lineCandidate;

  state.detectionDebug = {
    method: chosen ? "grid-lines" : "none",
    requestedMode: "grid-lines",
    frames: buildDetectionDebugFrames(lineCandidate),
    lineCandidateMeta: lineCandidate?.meta || null,
  };
  state.detectionDebugFrameIndex = -1;

  if (!chosen) {
    state.corners = [];
    state.activeCorners = [];
    state.persistentDebugQuad = null;
    state.warpedImageData = null;
    state.warpPreviewCanvas = null;
    if (!suppressStatus) {
      setStatus(
        cornerStatus,
        "Grid scan could not lock the board. Crop tighter or click 4 corners manually."
      );
    }
  } else {
    const candidatePoints = extractEdgeFeaturePoints(edges);
    const orderedOriginal = orderedCorners(chosen.points);
    const refinedOriginal = refineCornersByQuadrants(candidatePoints, orderedOriginal);
    const expandFactor = 1.012;
    const expandedOriginal = expandCornersOutward(refinedOriginal, src.cols, src.rows, expandFactor);
    const points = expandedOriginal.map(originalToCanvas);
    state.corners = orderedCorners(points);
    state.persistentDebugQuad = {
      points: expandedOriginal,
      color: "rgba(196, 56, 56, 0.98)",
      fill: "rgba(196, 56, 56, 0.10)",
      width: 4,
    };
    drawSourceImage();

    if (!suppressStatus) {
      setStatus(
        cornerStatus,
        "Grid scan locked the board border. Review and adjust manually if needed."
      );
    }
  }

  src.delete();
  gray.delete();
  denoised.delete();
  contrasted.delete();
  edgesRaw.delete();
  edges.delete();
  morphKernel.delete();
  if (state.detectionDebug?.frames?.length) {
    playDetectionReplay();
  }
  return Boolean(chosen && state.corners.length === 4);
}
```
