const ANALYSIS_LIMIT = 1200;
const RECTIFIED_SIZE = 800;
const BOARD_SIZES = [9, 13, 19];

export async function runImagePipeline({ image, manualCorners = null, boardSizeOverride = null }) {
  if (!image) {
    return emptyPipelineResult();
  }

  const preprocess = preprocessImage(image);
  const boardCandidate = manualCorners
    ? createManualBoardCandidate(preprocess, manualCorners)
    : detectBoardCandidate(preprocess);
  const rectified = boardCandidate.corners
    ? rectifyBoard(preprocess, boardCandidate.corners, RECTIFIED_SIZE)
    : null;
  const boardSize = rectified
    ? estimateBoardSize(rectified, boardSizeOverride)
    : {
        confidence: 0,
        reason: "No rectified board available.",
        selected: boardSizeOverride ?? null,
      };
  const grid = rectified && boardSize.selected
    ? buildIntersectionGrid(rectified.size, boardSize.selected, boardSize.marginRatio)
    : null;
  const stones = rectified && grid
    ? classifyIntersections(rectified, grid)
    : { counts: { black: 0, empty: 0, white: 0 }, intersections: [] };
  const stages = buildDebugStages(preprocess, rectified);

  return {
    boardCandidate,
    boardSize,
    grid,
    preprocess,
    rectified,
    stages,
    stones,
  };
}

function emptyPipelineResult() {
  return {
    boardCandidate: { confidence: 0, corners: null, mode: "none", reason: "No image loaded." },
    boardSize: { confidence: 0, reason: "No image loaded.", selected: null },
    grid: null,
    preprocess: null,
    rectified: null,
    stages: [],
    stones: { counts: { black: 0, empty: 0, white: 0 }, intersections: [] },
  };
}

function preprocessImage(image) {
  const scale = Math.max(image.naturalWidth, image.naturalHeight) / ANALYSIS_LIMIT;
  const normalizedScale = Math.max(scale, 1);
  const width = Math.round(image.naturalWidth / normalizedScale);
  const height = Math.round(image.naturalHeight / normalizedScale);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const grayscale = buildGrayscale(imageData);
  const normalized = normalizeArray(grayscale);
  const edges = buildEdgeMap(normalized, width, height);

  return {
    canvas,
    context,
    edges,
    grayscale,
    height,
    imageData,
    normalized,
    scale: normalizedScale,
    width,
  };
}

function createManualBoardCandidate(preprocess, manualCorners) {
  const scale = 1 / preprocess.scale;

  return {
    confidence: 1,
    corners: manualCorners.map((corner) => ({
      x: corner.x * scale,
      y: corner.y * scale,
    })),
    mode: "manual",
    reason: "Using manually supplied corners.",
  };
}

function detectBoardCandidate(preprocess) {
  const xProfile = buildProfile(preprocess.normalized, preprocess.width, preprocess.height, "vertical");
  const yProfile = buildProfile(preprocess.normalized, preprocess.width, preprocess.height, "horizontal");
  const xBounds = detectProfileBounds(xProfile, preprocess.width);
  const yBounds = detectProfileBounds(yProfile, preprocess.height);
  const coverage = ((xBounds.end - xBounds.start) / preprocess.width + (yBounds.end - yBounds.start) / preprocess.height) / 2;
  const confidence = clamp(0.15 + coverage * 0.55 - xBounds.edgePenalty * 0.2 - yBounds.edgePenalty * 0.2, 0.1, 0.72);

  return {
    confidence,
    corners: [
      { x: xBounds.start, y: yBounds.start },
      { x: xBounds.end, y: yBounds.start },
      { x: xBounds.end, y: yBounds.end },
      { x: xBounds.start, y: yBounds.end },
    ],
    mode: "auto",
    reason:
      confidence >= 0.55
        ? "Detected a plausible board region from content bounds."
        : "Low-confidence rectangular board candidate inferred from image content.",
  };
}

function estimateBoardSize(rectified, boardSizeOverride) {
  if (boardSizeOverride) {
    return {
      confidence: 1,
      marginRatio: 0.06,
      reason: "Using manually selected board size.",
      selected: Number(boardSizeOverride),
      scores: [],
    };
  }

  const grayscale = buildGrayscale(rectified.imageData);
  const normalized = normalizeArray(grayscale);
  const xProfile = buildProfile(normalized, rectified.size, rectified.size, "vertical");
  const yProfile = buildProfile(normalized, rectified.size, rectified.size, "horizontal");
  const scores = BOARD_SIZES.map((size) => scoreBoardSize(xProfile, yProfile, size));
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  const next = scores[1];
  const confidence = clamp(0.35 + (best.score - next.score) * 1.8, 0.2, 0.9);

  return {
    confidence,
    marginRatio: best.marginRatio,
    reason:
      confidence >= 0.6
        ? `Estimated board size as ${best.size}x${best.size}.`
        : `Weak board-size estimate. Defaulting to ${best.size}x${best.size}.`,
    scores,
    selected: best.size,
  };
}

function buildIntersectionGrid(rectifiedSize, boardSize, marginRatio) {
  const margin = rectifiedSize * marginRatio;
  const spacing = (rectifiedSize - margin * 2) / Math.max(boardSize - 1, 1);
  const intersections = [];

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      intersections.push({
        col,
        row,
        x: margin + col * spacing,
        y: margin + row * spacing,
      });
    }
  }

  return {
    boardSize,
    intersections,
    margin,
    spacing,
  };
}

function classifyIntersections(rectified, grid) {
  const grayscale = buildGrayscale(rectified.imageData);
  const results = [];
  const counts = { black: 0, empty: 0, white: 0 };

  for (const intersection of grid.intersections) {
    const reading = sampleIntersection(grayscale, rectified.size, intersection, grid.spacing);
    const state = classifySample(reading);

    counts[state.value] += 1;
    results.push({
      ...intersection,
      confidence: state.confidence,
      reading,
      value: state.value,
    });
  }

  return {
    counts,
    intersections: results,
  };
}

function buildDebugStages(preprocess, rectified) {
  const stages = [
    {
      label: "Source",
      url: preprocess.canvas.toDataURL("image/png"),
    },
    {
      label: "Grayscale",
      url: buildDataUrlFromScalarMap(preprocess.grayscale, preprocess.width, preprocess.height),
    },
    {
      label: "Edges",
      url: buildDataUrlFromScalarMap(preprocess.edges, preprocess.width, preprocess.height),
    },
  ];

  if (rectified) {
    stages.push({
      label: "Rectified",
      url: rectified.canvas.toDataURL("image/png"),
    });
  }

  return stages;
}

function buildProfile(values, width, height, axis) {
  const isVertical = axis === "vertical";
  const primaryLength = isVertical ? width : height;
  const secondaryLength = isVertical ? height : width;
  const profile = new Float32Array(primaryLength);

  for (let primary = 0; primary < primaryLength; primary += 1) {
    let sum = 0;

    for (let secondary = 0; secondary < secondaryLength; secondary += 1) {
      const x = isVertical ? primary : secondary;
      const y = isVertical ? secondary : primary;
      sum += 1 - values[y * width + x];
    }

    profile[primary] = sum / secondaryLength;
  }

  return smoothArray(profile, 4);
}

function detectProfileBounds(profile, axisSize) {
  const mean = average(profile);
  const deviation = standardDeviation(profile, mean);
  const threshold = mean + deviation * 0.1;
  const start = findFirstCrossing(profile, threshold);
  const end = findLastCrossing(profile, threshold);
  const edgePenalty =
    (start < axisSize * 0.03 ? 0.5 : 0) +
    (end > axisSize * 0.97 ? 0.5 : 0);

  return {
    edgePenalty,
    end: clamp(end, 0, axisSize - 1),
    start: clamp(start, 0, axisSize - 1),
  };
}

function rectifyBoard(preprocess, corners, size) {
  const destinationCorners = [
    { x: 0, y: 0 },
    { x: size - 1, y: 0 },
    { x: size - 1, y: size - 1 },
    { x: 0, y: size - 1 },
  ];
  const homography = computeHomography(destinationCorners, corners);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(size, size);

  canvas.width = size;
  canvas.height = size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourcePoint = applyHomography(homography, x, y);
      const rgba = sampleBilinear(preprocess.imageData.data, preprocess.width, preprocess.height, sourcePoint.x, sourcePoint.y);
      const index = (y * size + x) * 4;

      imageData.data[index] = rgba[0];
      imageData.data[index + 1] = rgba[1];
      imageData.data[index + 2] = rgba[2];
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);

  return {
    canvas,
    corners,
    imageData,
    size,
  };
}

function scoreBoardSize(xProfile, yProfile, size) {
  let best = null;

  for (let marginRatio = 0.04; marginRatio <= 0.09; marginRatio += 0.005) {
    const xScore = scoreLattice(xProfile, size, marginRatio);
    const yScore = scoreLattice(yProfile, size, marginRatio);
    const combinedScore = (xScore.score + yScore.score) / 2;

    if (!best || combinedScore > best.score) {
      best = {
        marginRatio,
        score: combinedScore,
        size,
      };
    }
  }

  return best;
}

function scoreLattice(profile, size, marginRatio) {
  const margin = profile.length * marginRatio;
  const spacing = (profile.length - margin * 2) / Math.max(size - 1, 1);
  let lineScore = 0;
  let gapScore = 0;

  for (let index = 0; index < size; index += 1) {
    const position = margin + index * spacing;
    lineScore += sampleScalar(profile, position);

    if (index < size - 1) {
      gapScore += sampleScalar(profile, position + spacing / 2);
    }
  }

  return {
    score: lineScore / size - gapScore / Math.max(size - 1, 1) * 0.4,
  };
}

function sampleIntersection(grayscale, size, intersection, spacing) {
  const centerRadius = Math.max(2, spacing * 0.18);
  const ringInner = spacing * 0.25;
  const ringOuter = spacing * 0.42;
  let centerSum = 0;
  let centerCount = 0;
  let ringSum = 0;
  let ringCount = 0;

  for (let offsetY = -Math.ceil(ringOuter); offsetY <= Math.ceil(ringOuter); offsetY += 1) {
    for (let offsetX = -Math.ceil(ringOuter); offsetX <= Math.ceil(ringOuter); offsetX += 1) {
      const x = Math.round(intersection.x + offsetX);
      const y = Math.round(intersection.y + offsetY);

      if (x < 0 || x >= size || y < 0 || y >= size) {
        continue;
      }

      const distance = Math.sqrt(offsetX ** 2 + offsetY ** 2);
      const value = grayscale[y * size + x];

      if (distance <= centerRadius) {
        centerSum += value;
        centerCount += 1;
      } else if (distance >= ringInner && distance <= ringOuter) {
        ringSum += value;
        ringCount += 1;
      }
    }
  }

  return {
    center: centerSum / Math.max(centerCount, 1),
    ring: ringSum / Math.max(ringCount, 1),
  };
}

function classifySample(reading) {
  const delta = reading.center - reading.ring;

  if (delta < -28) {
    return {
      confidence: clamp(Math.abs(delta) / 70, 0.25, 0.98),
      value: "black",
    };
  }

  if (delta > 16) {
    return {
      confidence: clamp(delta / 55, 0.2, 0.95),
      value: "white",
    };
  }

  return {
    confidence: clamp(1 - Math.abs(delta) / 24, 0.2, 0.9),
    value: "empty",
  };
}

function buildGrayscale(imageData) {
  const grayscale = new Float32Array(imageData.data.length / 4);

  for (let sourceIndex = 0, pixelIndex = 0; sourceIndex < imageData.data.length; sourceIndex += 4) {
    grayscale[pixelIndex] =
      imageData.data[sourceIndex] * 0.299 +
      imageData.data[sourceIndex + 1] * 0.587 +
      imageData.data[sourceIndex + 2] * 0.114;
    pixelIndex += 1;
  }

  return grayscale;
}

function buildEdgeMap(normalized, width, height) {
  const edges = new Float32Array(normalized.length);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = normalized[index + 1] - normalized[index - 1];
      const dy = normalized[index + width] - normalized[index - width];
      edges[index] = Math.min(Math.sqrt(dx * dx + dy * dy) * 2.4, 1);
    }
  }

  return edges;
}

function normalizeArray(values) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const range = Math.max(maximum - minimum, 1e-6);
  const normalized = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = (values[index] - minimum) / range;
  }

  return normalized;
}

function buildDataUrlFromScalarMap(values, width, height) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  canvas.width = width;
  canvas.height = height;

  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const range = Math.max(maximum - minimum, 1e-6);

  for (let index = 0; index < values.length; index += 1) {
    const pixel = clamp(Math.round(((values[index] - minimum) / range) * 255), 0, 255);
    const offset = index * 4;

    imageData.data[offset] = pixel;
    imageData.data[offset + 1] = pixel;
    imageData.data[offset + 2] = pixel;
    imageData.data[offset + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

function computeHomography(destinationCorners, sourceCorners) {
  const matrix = [];
  const vector = [];

  for (let index = 0; index < 4; index += 1) {
    const { x, y } = destinationCorners[index];
    const source = sourceCorners[index];

    matrix.push([x, y, 1, 0, 0, 0, -source.x * x, -source.x * y]);
    matrix.push([0, 0, 0, x, y, 1, -source.y * x, -source.y * y]);
    vector.push(source.x, source.y);
  }

  const solution = solveLinearSystem(matrix, vector);

  return [
    solution[0], solution[1], solution[2],
    solution[3], solution[4], solution[5],
    solution[6], solution[7], 1,
  ];
}

function solveLinearSystem(matrix, vector) {
  const rowCount = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < rowCount; pivot += 1) {
    let bestRow = pivot;

    for (let row = pivot + 1; row < rowCount; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) {
        bestRow = row;
      }
    }

    [augmented[pivot], augmented[bestRow]] = [augmented[bestRow], augmented[pivot]];

    const pivotValue = augmented[pivot][pivot] || 1e-9;

    for (let column = pivot; column <= rowCount; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < rowCount; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];

      for (let column = pivot; column <= rowCount; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[rowCount]);
}

function applyHomography(matrix, x, y) {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];

  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  };
}

function sampleBilinear(data, width, height, x, y) {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const topLeft = getRgba(data, width, x0, y0);
  const topRight = getRgba(data, width, x1, y0);
  const bottomLeft = getRgba(data, width, x0, y1);
  const bottomRight = getRgba(data, width, x1, y1);

  return [0, 1, 2].map((channel) => {
    const top = topLeft[channel] * (1 - tx) + topRight[channel] * tx;
    const bottom = bottomLeft[channel] * (1 - tx) + bottomRight[channel] * tx;

    return Math.round(top * (1 - ty) + bottom * ty);
  });
}

function getRgba(data, width, x, y) {
  const index = (y * width + x) * 4;

  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function sampleScalar(values, position) {
  const left = clamp(Math.floor(position), 0, values.length - 1);
  const right = clamp(left + 1, 0, values.length - 1);
  const mix = clamp(position - left, 0, 1);

  return values[left] * (1 - mix) + values[right] * mix;
}

function smoothArray(values, radius) {
  const smoothed = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    let total = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const sampleIndex = index + offset;

      if (sampleIndex < 0 || sampleIndex >= values.length) {
        continue;
      }

      total += values[sampleIndex];
      count += 1;
    }

    smoothed[index] = total / Math.max(count, 1);
  }

  return smoothed;
}

function findFirstCrossing(profile, threshold) {
  for (let index = 0; index < profile.length; index += 1) {
    if (profile[index] >= threshold) {
      return index;
    }
  }

  return 0;
}

function findLastCrossing(profile, threshold) {
  for (let index = profile.length - 1; index >= 0; index -= 1) {
    if (profile[index] >= threshold) {
      return index;
    }
  }

  return profile.length - 1;
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

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
