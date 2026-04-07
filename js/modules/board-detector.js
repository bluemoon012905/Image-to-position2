const MAX_ANALYSIS_SIZE = 900;
const GRID_LINE_COUNTS = [19, 13, 9];

export async function detectBoardOutline(image) {
  const source = rasterizeImage(image);
  const grayscale = toGrayscale(source.data);
  const verticalProfile = buildCombinedProfile(source, grayscale, "vertical");
  const horizontalProfile = buildCombinedProfile(source, grayscale, "horizontal");
  const xPeaks = findPeaks(verticalProfile, source.width);
  const yPeaks = findPeaks(horizontalProfile, source.height);
  const xGrid = fitRegularGrid(xPeaks, source.width);
  const yGrid = fitRegularGrid(yPeaks, source.height);

  if (!xGrid || !yGrid) {
    return {
      confidence: 0,
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
    expansionSteps: expansionSteps.map((step) => scaleRect(step, source.scale)),
    status:
      `Detected a ${xGrid.lineCount}x${yGrid.lineCount} board lattice with ${Math.round(confidence * 100)}% confidence.`,
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
    profile[index] = darkness[index] * 0.58 + edges[index] * 0.42;
  }

  return smoothProfile(profile, 2);
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
      const secondaryWeight = axisWeight(secondary, secondaryLength);

      score += darkness * secondaryWeight;
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
      const secondaryWeight = axisWeight(secondary, secondaryLength);

      score += delta * secondaryWeight;
    }

    profile[primary] = score / secondaryLength;
  }

  return profile;
}

function axisWeight(position, length) {
  const normalized = (position + 0.5) / length;
  return 0.45 + Math.sin(normalized * Math.PI) * 0.55;
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

function findPeaks(profile, axisSize) {
  const mean = average(profile);
  const deviation = standardDeviation(profile, mean);
  const threshold = mean + deviation * 0.55;
  const peaks = [];
  const minDistance = Math.max(3, Math.round(axisSize * 0.012));

  for (let index = 2; index < profile.length - 2; index += 1) {
    const current = profile[index];

    if (
      current > threshold &&
      current >= profile[index - 1] &&
      current >= profile[index + 1] &&
      current >= profile[index - 2] &&
      current >= profile[index + 2]
    ) {
      const previousPeak = peaks.at(-1);

      if (!previousPeak || index - previousPeak.position >= minDistance) {
        peaks.push({ position: index, strength: current });
        continue;
      }

      if (current > previousPeak.strength) {
        previousPeak.position = index;
        previousPeak.strength = current;
      }
    }
  }

  return peaks;
}

function fitRegularGrid(peaks, axisSize) {
  if (peaks.length < 6) {
    return null;
  }

  const spacingCandidates = collectSpacingCandidates(peaks, axisSize);
  let bestGrid = null;

  for (const spacing of spacingCandidates) {
    const tolerance = Math.max(2, spacing * 0.22);
    const anchors = collectAnchorCandidates(peaks, spacing);

    for (const anchor of anchors) {
      const lattice = buildLatticeLines(anchor, spacing, axisSize);

      for (const lineCount of GRID_LINE_COUNTS) {
        if (lattice.length < lineCount) {
          continue;
        }

        for (let startIndex = 0; startIndex <= lattice.length - lineCount; startIndex += 1) {
          const candidate = lattice.slice(startIndex, startIndex + lineCount);
          const scored = scoreGridCandidate(
            candidate,
            peaks,
            spacing,
            tolerance,
            axisSize,
            lineCount,
          );

          if (!scored) {
            continue;
          }

          if (!bestGrid || scored.score > bestGrid.score) {
            bestGrid = {
              end: scored.lines.at(-1),
              lineCount,
              lines: scored.lines,
              matchedCount: scored.matchedCount,
              score: scored.score,
              spacing,
              start: scored.lines[0],
            };
          }
        }
      }
    }
  }

  return bestGrid;
}

function collectSpacingCandidates(peaks, axisSize) {
  const minSpacing = axisSize * 0.025;
  const maxSpacing = axisSize * 0.11;
  const candidates = new Set();

  for (let leftIndex = 0; leftIndex < peaks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < peaks.length; rightIndex += 1) {
      const gap = peaks[rightIndex].position - peaks[leftIndex].position;

      for (let divisor = 1; divisor <= 18; divisor += 1) {
        const spacing = gap / divisor;

        if (spacing < minSpacing || spacing > maxSpacing) {
          continue;
        }

        candidates.add(roundToHalf(spacing));
      }
    }
  }

  return [...candidates].sort((left, right) => left - right);
}

function collectAnchorCandidates(peaks, spacing) {
  const anchors = new Set();

  for (const peak of peaks) {
    const normalized = peak.position % spacing;
    anchors.add(roundToHalf(normalized));
    anchors.add(roundToHalf(normalized - spacing));
  }

  return [...anchors];
}

function buildLatticeLines(anchor, spacing, axisSize) {
  const lines = [];
  const start = Math.floor((0 - anchor) / spacing) - 1;
  const end = Math.ceil((axisSize - anchor) / spacing) + 1;

  for (let index = start; index <= end; index += 1) {
    const position = anchor + index * spacing;

    if (position < 0 || position > axisSize) {
      continue;
    }

    lines.push(position);
  }

  return lines;
}

function scoreGridCandidate(lines, peaks, spacing, tolerance, axisSize, lineCount) {
  let matchedCount = 0;
  let strengthScore = 0;
  let totalDistance = 0;
  const snappedLines = [];
  const usedPeaks = new Set();

  for (const line of lines) {
    const match = findBestPeakMatch(line, peaks, tolerance, usedPeaks);

    if (!match) {
      snappedLines.push(line);
      continue;
    }

    usedPeaks.add(match.peak);
    matchedCount += 1;
    totalDistance += match.distance;
    strengthScore += match.peak.strength;
    snappedLines.push(match.peak.position);
  }

  if (matchedCount < Math.max(6, lines.length * 0.55)) {
    return null;
  }

  const coverage = (snappedLines.at(-1) - snappedLines[0]) / axisSize;
  const distancePenalty = totalDistance / Math.max(matchedCount * tolerance, 1);
  const matchRatio = matchedCount / lines.length;
  const meanStrength = strengthScore / matchedCount;
  const edgeMargin = Math.min(snappedLines[0], axisSize - snappedLines.at(-1)) / spacing;
  const countPreference =
    lineCount === 19 ? 0.28 : lineCount === 13 ? 0.16 : lineCount === 9 ? 0.08 : 0;
  const score =
    matchRatio * 2.4 +
    meanStrength * 1.2 +
    coverage * 0.6 -
    distancePenalty * 0.7 +
    Math.min(edgeMargin, 2) * 0.15 +
    countPreference;

  return {
    lines: snappedLines,
    matchedCount,
    score,
  };
}

function findBestPeakMatch(target, peaks, tolerance, usedPeaks) {
  let bestMatch = null;

  for (const peak of peaks) {
    if (usedPeaks.has(peak)) {
      continue;
    }

    const distance = Math.abs(peak.position - target);

    if (distance > tolerance) {
      continue;
    }

    if (
      !bestMatch ||
      distance < bestMatch.distance ||
      (distance === bestMatch.distance && peak.strength > bestMatch.peak.strength)
    ) {
      bestMatch = { distance, peak };
    }
  }

  return bestMatch;
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
  const matchScore =
    (xGrid.matchedCount / xGrid.lineCount + yGrid.matchedCount / yGrid.lineCount) / 2;
  const spacingMatch =
    1 - Math.min(Math.abs(xGrid.spacing - yGrid.spacing) / Math.max(xGrid.spacing, yGrid.spacing), 1);
  const lineCountBonus = xGrid.lineCount === yGrid.lineCount ? 1 : 0.75;

  return Math.max(
    0.1,
    Math.min(0.99, matchScore * 0.55 + spacingMatch * 0.3 + lineCountBonus * 0.15),
  );
}

function average(values) {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}

function standardDeviation(values, mean) {
  let total = 0;

  for (const value of values) {
    total += (value - mean) ** 2;
  }

  return Math.sqrt(total / values.length);
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
