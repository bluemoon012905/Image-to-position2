const MAX_ANALYSIS_SIZE = 900;
const GRID_LINE_COUNTS = [19, 13, 9];

export async function detectBoardOutline(image) {
  const source = rasterizeImage(image);
  const grayscale = toGrayscale(source.data);
  const verticalProfile = buildCombinedProfile(source, grayscale, "vertical");
  const horizontalProfile = buildCombinedProfile(source, grayscale, "horizontal");
  const xResult = detectGridFromProfile(verticalProfile, source.width);
  const yResult = detectGridFromProfile(horizontalProfile, source.height);
  const xGrid = xResult.grid;
  const yGrid = yResult.grid;

  if (!xGrid || !yGrid) {
    return {
      confidence: 0,
      debugMeta: {
        failure: true,
        xAxis: xResult.debug,
        yAxis: yResult.debug,
      },
      status: "No strong board grid found. Try manual draw.",
    };
  }

  const bounds = {
    left: clamp(xGrid.start - xGrid.spacing * 0.5, 0, source.width - 1),
    right: clamp(xGrid.end + xGrid.spacing * 0.5, 0, source.width - 1),
    top: clamp(yGrid.start - yGrid.spacing * 0.5, 0, source.height - 1),
    bottom: clamp(yGrid.end + yGrid.spacing * 0.5, 0, source.height - 1),
  };

  const expansionSteps = buildExpansionSteps(xGrid, yGrid, source);
  const confidence = estimateConfidence(xGrid, yGrid);

  return {
    confidence,
    corners: scaleCorners(
      [
        { x: bounds.left, y: bounds.top },
        { x: bounds.right, y: bounds.top },
        { x: bounds.right, y: bounds.bottom },
        { x: bounds.left, y: bounds.bottom },
      ],
      source.scale,
    ),
    debug: {
      xLines: scaleValues(xGrid.lines, source.scale),
      yLines: scaleValues(yGrid.lines, source.scale),
    },
    debugMeta: {
      bounds: scaleRect(bounds, source.scale),
      failure: false,
      xGrid: {
        lineCount: xGrid.lineCount,
        lines: scaleValues(xGrid.lines, source.scale),
        spacing: xGrid.spacing * source.scale,
        start: xGrid.start * source.scale,
        end: xGrid.end * source.scale,
      },
      xAxis: xResult.debug,
      yGrid: {
        lineCount: yGrid.lineCount,
        lines: scaleValues(yGrid.lines, source.scale),
        spacing: yGrid.spacing * source.scale,
        start: yGrid.start * source.scale,
        end: yGrid.end * source.scale,
      },
      yAxis: yResult.debug,
    },
    expansionSteps: expansionSteps.map((step) => scaleRect(step, source.scale)),
    status:
      `Detected a ${xGrid.lineCount}x${yGrid.lineCount} grid at ${Math.round(confidence * 100)}% confidence.`,
  };
}

function rasterizeImage(image) {
  const scale = Math.max(image.naturalWidth, image.naturalHeight) / MAX_ANALYSIS_SIZE;
  const normalizedScale = Math.max(scale, 1);
  const width = Math.round(image.naturalWidth / normalizedScale);
  const height = Math.round(image.naturalHeight / normalizedScale);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  return {
    data: context.getImageData(0, 0, width, height),
    height,
    scale: normalizedScale,
    width,
  };
}

function toGrayscale(imageData) {
  const grayscale = new Float32Array(imageData.length / 4);

  for (let sourceIndex = 0, pixelIndex = 0; sourceIndex < imageData.length; sourceIndex += 4) {
    const red = imageData[sourceIndex];
    const green = imageData[sourceIndex + 1];
    const blue = imageData[sourceIndex + 2];
    grayscale[pixelIndex] = red * 0.299 + green * 0.587 + blue * 0.114;
    pixelIndex += 1;
  }

  return grayscale;
}

function buildCombinedProfile(source, grayscale, axis) {
  const darkness = normalizeProfile(
    smoothProfile(buildDarknessProjection(source, grayscale, axis), 2),
  );
  const edges = normalizeProfile(
    smoothProfile(buildEdgeProjection(source, grayscale, axis), 2),
  );
  const profile = new Float32Array(darkness.length);

  for (let index = 0; index < profile.length; index += 1) {
    profile[index] = darkness[index] * 0.68 + edges[index] * 0.32;
  }

  return smoothProfile(profile, 1);
}

function buildDarknessProjection(source, grayscale, axis) {
  const isVertical = axis === "vertical";
  const primaryLength = isVertical ? source.width : source.height;
  const secondaryLength = isVertical ? source.height : source.width;
  const profile = new Float32Array(primaryLength);

  for (let primary = 0; primary < primaryLength; primary += 1) {
    let score = 0;

    for (let secondary = 0; secondary < secondaryLength; secondary += 1) {
      const x = isVertical ? primary : secondary;
      const y = isVertical ? secondary : primary;
      const index = y * source.width + x;
      const darkness = 255 - grayscale[index];
      score += darkness * axisWeight(secondary, secondaryLength);
    }

    profile[primary] = score / secondaryLength;
  }

  return profile;
}

function buildEdgeProjection(source, grayscale, axis) {
  const isVertical = axis === "vertical";
  const primaryLength = isVertical ? source.width : source.height;
  const secondaryLength = isVertical ? source.height : source.width;
  const profile = new Float32Array(primaryLength);

  for (let primary = 1; primary < primaryLength - 1; primary += 1) {
    let score = 0;

    for (let secondary = 1; secondary < secondaryLength - 1; secondary += 1) {
      const x = isVertical ? primary : secondary;
      const y = isVertical ? secondary : primary;
      const index = y * source.width + x;
      const delta = isVertical
        ? Math.abs(grayscale[index + 1] - grayscale[index - 1])
        : Math.abs(grayscale[index + source.width] - grayscale[index - source.width]);
      score += delta * axisWeight(secondary, secondaryLength);
    }

    profile[primary] = score / secondaryLength;
  }

  return profile;
}

function detectGridFromProfile(profile, axisSize) {
  const spacing = estimateGridSpacing(profile, axisSize);
  const clusters = spacing ? collectPeakClusters(profile, axisSize) : [];
  const run = spacing ? findBestGridRun(clusters, spacing) : null;
  const debug = {
    axisSize,
    clusters: clusters.map((cluster) => ({
      position: roundDebug(cluster.position),
      strength: roundDebug(cluster.strength),
    })),
    rejectedMarginCandidates: [],
    run: run
      ? {
          first: roundDebug(run.first.position),
          last: roundDebug(run.last.position),
          observedLines: run.observedLines,
          positions: run.run.map((cluster) => roundDebug(cluster.position)),
          spacing: roundDebug(run.spacing),
        }
      : null,
    spacing: spacing ? roundDebug(spacing) : null,
  };

  if (!spacing) {
    return {
      debug,
      grid: null,
    };
  }

  const expanded = expandRunToBoard(run, clusters, profile, spacing, axisSize, debug);
  let bestGrid = null;

  if (expanded) {
    bestGrid = expanded;
  }

  for (const lineCount of GRID_LINE_COUNTS) {
    const candidateResult = findBestGridWindow(
      profile,
      axisSize,
      spacing,
      lineCount,
      debug,
    );
    const candidate = candidateResult?.grid;

    if (!candidate) {
      continue;
    }

    if (!bestGrid || candidate.score > bestGrid.score) {
      bestGrid = candidate;
    }
  }

  return {
    debug,
    grid: bestGrid,
  };
}

function collectPeakClusters(profile, axisSize) {
  const peaks = [];
  const mean = average(profile);
  const deviation = standardDeviation(profile, mean);
  const threshold = mean + deviation * 0.28;
  const minDistance = Math.max(2, Math.round(axisSize * 0.01));

  for (let index = 2; index < profile.length - 2; index += 1) {
    const current = profile[index];

    if (
      current < threshold ||
      current < profile[index - 1] ||
      current < profile[index + 1] ||
      current < profile[index - 2] ||
      current < profile[index + 2]
    ) {
      continue;
    }

    const previous = peaks.at(-1);

    if (previous && index - previous.position <= minDistance) {
      if (current > previous.strength) {
        previous.position = index;
        previous.strength = current;
      }
      continue;
    }

    peaks.push({
      position: index,
      strength: current,
    });
  }

  return peaks;
}

function estimateGridSpacing(profile, axisSize) {
  const minSpacing = Math.max(8, Math.round(axisSize * 0.03));
  const maxSpacing = Math.max(minSpacing + 1, Math.round(axisSize * 0.09));
  let bestSpacing = null;

  for (let spacing = minSpacing; spacing <= maxSpacing; spacing += 1) {
    let score = 0;
    let count = 0;

    for (let index = 0; index + spacing < profile.length; index += 1) {
      score += profile[index] * profile[index + spacing];
      count += 1;
    }

    const normalizedScore = score / Math.max(count, 1);

    if (!bestSpacing || normalizedScore > bestSpacing.score) {
      bestSpacing = { score: normalizedScore, spacing };
    }
  }

  return bestSpacing?.spacing ?? null;
}

function findBestGridWindow(profile, axisSize, spacing, lineCount, debug) {
  const phaseLimit = Math.max(1, Math.round(spacing));
  let bestWindow = null;
  const spanCheck = getBoardSpanCheck(spacing, axisSize, lineCount);

  if (!spanCheck.valid) {
    trackRejectedMargin(debug, {
      lineCount,
      path: "window-span",
      firstMargin: roundDebug(spanCheck.minSpacing),
      lastMargin: roundDebug(spanCheck.maxSpacing),
      minMargin: roundDebug(spacing),
      maxMargin: roundDebug(spanCheck.requiredCoverage),
    });
    return null;
  }

  for (let phase = 0; phase < phaseLimit; phase += 1) {
    const lattice = [];

    for (let position = phase; position < axisSize; position += spacing) {
      lattice.push(position);
    }

    if (lattice.length < lineCount) {
      continue;
    }

    for (let startIndex = 0; startIndex <= lattice.length - lineCount; startIndex += 1) {
      const expectedLines = lattice.slice(startIndex, startIndex + lineCount);
      const snappedLines = expectedLines.map((position) =>
        snapToLocalPeak(profile, Math.round(position), Math.max(2, Math.round(spacing * 0.22))),
      );
      const marginCheck = getBoardMarginCheck(snappedLines, spacing, axisSize);
      if (!marginCheck.valid) {
        trackRejectedMargin(debug, {
          lineCount,
          path: "window",
          ...marginCheck,
        });
        continue;
      }
      const score = scoreGridWindow(profile, snappedLines, spacing, axisSize, lineCount);

      if (!bestWindow || score > bestWindow.score) {
        bestWindow = {
          end: snappedLines.at(-1),
          lineCount,
          lines: snappedLines,
          matchedCount: snappedLines.length,
          score,
          spacing,
          start: snappedLines[0],
        };
      }
    }
  }

  if (!bestWindow) {
    return {
      debug,
      grid: null,
    };
  }

  const coverage = (bestWindow.end - bestWindow.start) / axisSize;

  if (coverage < 0.45) {
    debug.coverage = roundDebug(coverage);
    return {
      debug,
      grid: null,
    };
  }

  debug.coverage = roundDebug(coverage);

  return {
    debug,
    grid: bestWindow,
  };
}

function findBestGridRun(clusters, spacing) {
  if (!clusters.length) {
    return null;
  }

  const tolerance = Math.max(3, spacing * 0.28);
  let best = null;

  for (let start = 0; start < clusters.length; start += 1) {
    const run = [clusters[start]];
    let strength = clusters[start].strength;
    let gaps = 0;

    for (let index = start + 1; index < clusters.length; index += 1) {
      const previous = run.at(-1);
      const next = clusters[index];
      const diff = next.position - previous.position;
      const steps = Math.max(1, Math.round(diff / spacing));
      const expected = steps * spacing;

      if (steps > 3 || Math.abs(diff - expected) > tolerance * steps) {
        if (diff > spacing * 3.5) {
          break;
        }
        continue;
      }

      run.push(next);
      strength += next.strength;
      gaps += Math.max(0, steps - 1);
    }

    if (run.length < 4) {
      continue;
    }

    const first = run[0];
    const last = run.at(-1);
    const coveredSpan = last.position - first.position;
    const score = run.length * 18 + strength * 14 + coveredSpan * 0.025 - gaps * 8;

    if (!best || score > best.score) {
      best = {
        coveredSpan,
        first,
        gaps,
        last,
        observedLines: run.length,
        run,
        score,
        spacing,
      };
    }
  }

  return best;
}

function expandRunToBoard(run, clusters, profile, spacing, axisSize, debug) {
  if (!run) {
    return null;
  }

  const tolerance = Math.max(3, spacing * 0.32);
  let best = null;

  for (const lineCount of GRID_LINE_COUNTS) {
    const spanCheck = getBoardSpanCheck(spacing, axisSize, lineCount);

    if (!spanCheck.valid) {
      trackRejectedMargin(debug, {
        lineCount,
        path: "expand-span",
        firstMargin: roundDebug(spanCheck.minSpacing),
        lastMargin: roundDebug(spanCheck.maxSpacing),
        minMargin: roundDebug(spacing),
        maxMargin: roundDebug(spanCheck.requiredCoverage),
      });
      continue;
    }

    const missing = Math.max(0, lineCount - run.observedLines);

    for (let leftMissing = 0; leftMissing <= missing; leftMissing += 1) {
      const rightMissing = missing - leftMissing;
      const start = run.first.position - leftMissing * spacing;
      const lines = [];

      for (let index = 0; index < lineCount; index += 1) {
        const expected = start + index * spacing;

        if (expected < -spacing || expected > axisSize + spacing) {
          lines.length = 0;
          break;
        }

        lines.push(snapToClusterOrPeak(clusters, profile, expected, tolerance));
      }

      if (lines.length !== lineCount) {
        continue;
      }

      const marginCheck = getBoardMarginCheck(lines, spacing, axisSize);
      if (!marginCheck.valid) {
        trackRejectedMargin(debug, {
          lineCount,
          path: "expand",
          ...marginCheck,
        });
        continue;
      }

      const score = scoreExpandedBoard(lines, run, profile, spacing, axisSize, lineCount);

      if (!best || score > best.score) {
        best = {
          end: lines.at(-1),
          lineCount,
          lines,
          matchedCount: run.observedLines,
          score,
          spacing,
          start: lines[0],
        };
      }
    }
  }

  return best;
}

function snapToClusterOrPeak(clusters, profile, expected, tolerance) {
  let bestCluster = null;

  for (const cluster of clusters) {
    const distance = Math.abs(cluster.position - expected);

    if (distance > tolerance) {
      continue;
    }

    if (
      !bestCluster ||
      distance < Math.abs(bestCluster.position - expected) ||
      (distance === Math.abs(bestCluster.position - expected) &&
        cluster.strength > bestCluster.strength)
    ) {
      bestCluster = cluster;
    }
  }

  if (bestCluster) {
    return bestCluster.position;
  }

  return snapToLocalPeak(profile, Math.round(expected), Math.max(2, Math.round(tolerance)));
}

function scoreExpandedBoard(lines, run, profile, spacing, axisSize, lineCount) {
  const windowScore = scoreGridWindow(profile, lines, spacing, axisSize, lineCount);
  const runCoverage = (run.last.position - run.first.position) / Math.max(spacing * (lineCount - 1), 1);
  const edgeReach = (lines.at(-1) - lines[0]) / axisSize;
  const observedRatio = run.observedLines / lineCount;

  return windowScore + runCoverage * 0.9 + edgeReach * 0.8 + observedRatio * 0.6;
}

function snapToLocalPeak(profile, center, radius) {
  let bestIndex = clamp(Math.round(center), 0, profile.length - 1);
  let bestValue = profile[bestIndex];

  for (let index = Math.max(0, center - radius); index <= Math.min(profile.length - 1, center + radius); index += 1) {
    if (profile[index] > bestValue) {
      bestIndex = index;
      bestValue = profile[index];
    }
  }

  return bestIndex;
}

function scoreGridWindow(profile, lines, spacing, axisSize, lineCount) {
  let profileScore = 0;
  let spacingPenalty = 0;

  for (let index = 0; index < lines.length; index += 1) {
    profileScore += profile[lines[index]];

    if (index > 0) {
      spacingPenalty += Math.abs(lines[index] - lines[index - 1] - spacing);
    }
  }

  const averageProfile = profileScore / lines.length;
  const averagePenalty = spacingPenalty / Math.max(lines.length - 1, 1);
  const coverage = (lines.at(-1) - lines[0]) / axisSize;
  const centerBias = 1 - Math.abs(axisSize / 2 - (lines[0] + lines.at(-1)) / 2) / (axisSize / 2);
  const firstMargin = lines[0];
  const lastMargin = axisSize - lines.at(-1);
  const smallerMargin = Math.min(firstMargin, lastMargin);
  const marginRatio = smallerMargin / Math.max(spacing, 1);
  const edgePenalty =
    marginRatio < 0.35 ? (0.35 - marginRatio) * 4.2 : 0;
  const edgeBonus =
    marginRatio >= 0.55 && marginRatio <= 1.8 ? 0.45 : 0;
  const lineCountBonus =
    lineCount === 19 ? 0.22 : lineCount === 13 ? 0.12 : 0.05;

  return (
    averageProfile * 2.2 +
    coverage * 0.9 +
    centerBias * 0.25 +
    lineCountBonus +
    edgeBonus -
    averagePenalty * 0.03 -
    edgePenalty
  );
}

function getBoardMarginCheck(lines, spacing, axisSize) {
  const firstMargin = lines[0];
  const lastMargin = axisSize - lines.at(-1);
  const minMargin = Math.max(4, spacing * 0.38);
  const maxMargin = spacing * 2.2;

  if (firstMargin < minMargin || lastMargin < minMargin) {
    return {
      firstMargin: roundDebug(firstMargin),
      lastMargin: roundDebug(lastMargin),
      maxMargin: roundDebug(maxMargin),
      minMargin: roundDebug(minMargin),
      valid: false,
    };
  }

  if (firstMargin > maxMargin || lastMargin > maxMargin) {
    return {
      firstMargin: roundDebug(firstMargin),
      lastMargin: roundDebug(lastMargin),
      maxMargin: roundDebug(maxMargin),
      minMargin: roundDebug(minMargin),
      valid: false,
    };
  }

  return {
    firstMargin: roundDebug(firstMargin),
    lastMargin: roundDebug(lastMargin),
    maxMargin: roundDebug(maxMargin),
    minMargin: roundDebug(minMargin),
    valid: true,
  };
}

function getBoardSpanCheck(spacing, axisSize, lineCount) {
  const boardSpan = spacing * (lineCount - 1);
  const coverage = boardSpan / Math.max(axisSize, 1);
  const requiredCoverage =
    lineCount === 19 ? 0.68 : lineCount === 13 ? 0.5 : 0.34;
  const minSpacing = (axisSize * requiredCoverage) / Math.max(lineCount - 1, 1);
  const maxSpacing = (axisSize * 0.96) / Math.max(lineCount - 1, 1);

  return {
    coverage: roundDebug(coverage),
    maxSpacing: roundDebug(maxSpacing),
    minSpacing: roundDebug(minSpacing),
    requiredCoverage: roundDebug(requiredCoverage),
    valid: coverage >= requiredCoverage && spacing <= maxSpacing,
  };
}

function average(values) {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / Math.max(values.length, 1);
}

function standardDeviation(values, mean) {
  let total = 0;

  for (const value of values) {
    total += (value - mean) ** 2;
  }

  return Math.sqrt(total / Math.max(values.length, 1));
}

function trackRejectedMargin(debug, entry) {
  if (debug.rejectedMarginCandidates.length >= 8) {
    return;
  }

  debug.rejectedMarginCandidates.push(entry);
}

function roundDebug(value) {
  return Math.round(value * 100) / 100;
}

function axisWeight(position, length) {
  const normalized = (position + 0.5) / length;
  return 0.5 + Math.sin(normalized * Math.PI) * 0.5;
}

function normalizeProfile(profile) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const value of profile) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const range = Math.max(maximum - minimum, 1e-6);
  const normalized = new Float32Array(profile.length);

  for (let index = 0; index < profile.length; index += 1) {
    normalized[index] = (profile[index] - minimum) / range;
  }

  return normalized;
}

function smoothProfile(profile, radius) {
  const smoothed = new Float32Array(profile.length);

  for (let index = 0; index < profile.length; index += 1) {
    let total = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const sampleIndex = index + offset;

      if (sampleIndex < 0 || sampleIndex >= profile.length) {
        continue;
      }

      total += profile[sampleIndex];
      count += 1;
    }

    smoothed[index] = total / count;
  }

  return smoothed;
}

function buildExpansionSteps(xGrid, yGrid, source) {
  const xMid = Math.floor(xGrid.lines.length / 2);
  const yMid = Math.floor(yGrid.lines.length / 2);
  const steps = [];
  const expansions = Math.max(xMid + 1, yMid + 1);

  for (let depth = 1; depth <= expansions; depth += 1) {
    const leftIndex = Math.max(0, xMid - depth);
    const rightIndex = Math.min(xGrid.lines.length - 1, xMid + depth);
    const topIndex = Math.max(0, yMid - depth);
    const bottomIndex = Math.min(yGrid.lines.length - 1, yMid + depth);

    steps.push({
      left: clamp(xGrid.lines[leftIndex] - xGrid.spacing * 0.5, 0, source.width - 1),
      right: clamp(xGrid.lines[rightIndex] + xGrid.spacing * 0.5, 0, source.width - 1),
      top: clamp(yGrid.lines[topIndex] - yGrid.spacing * 0.5, 0, source.height - 1),
      bottom: clamp(yGrid.lines[bottomIndex] + yGrid.spacing * 0.5, 0, source.height - 1),
    });
  }

  return steps;
}

function scaleRect(rect, scale) {
  return {
    bottom: rect.bottom * scale,
    left: rect.left * scale,
    right: rect.right * scale,
    top: rect.top * scale,
  };
}

function scaleCorners(corners, scale) {
  return corners.map((corner) => ({
    x: corner.x * scale,
    y: corner.y * scale,
  }));
}

function scaleValues(values, scale) {
  return values.map((value) => value * scale);
}

function estimateConfidence(xGrid, yGrid) {
  const spacingMatch =
    1 - Math.min(Math.abs(xGrid.spacing - yGrid.spacing) / Math.max(xGrid.spacing, yGrid.spacing), 1);
  const coverage =
    ((xGrid.end - xGrid.start) / Math.max(xGrid.spacing * (xGrid.lineCount - 1), 1) +
      (yGrid.end - yGrid.start) / Math.max(yGrid.spacing * (yGrid.lineCount - 1), 1)) /
    2;
  const lineCountBonus = xGrid.lineCount === yGrid.lineCount ? 1 : 0.7;

  return Math.max(
    0.1,
    Math.min(0.99, spacingMatch * 0.45 + coverage * 0.35 + lineCountBonus * 0.2),
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
