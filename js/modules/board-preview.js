export function createBoardPreview({
  boardCanvas,
  helpElement,
  imageStore,
  statusElement,
}) {
  if (!boardCanvas || !helpElement || !imageStore || !statusElement) {
    throw new Error("Board preview requires canvas, help text, status text, and imageStore.");
  }

  const context = boardCanvas.getContext("2d");
  const state = {
    image: null,
  };
  const resizeObserver = new ResizeObserver(() => {
    renderScene();
  });

  helpElement.textContent = "The image is shown as uploaded. Detection is currently disabled.";
  resizeObserver.observe(boardCanvas);

  imageStore.subscribe((snapshot) => {
    state.image = snapshot.image;
    statusElement.textContent = snapshot.image
      ? `Previewing ${snapshot.width}x${snapshot.height} image.`
      : "Upload an image to preview it here.";
    renderScene();
  });

  renderScene();

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
      drawEmptyState(context, width, height);
      return;
    }

    const view = fitImage(state.image, width, height);
    context.save();
    context.drawImage(state.image, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight);
    context.restore();
  }
}

function drawEmptyState(context, width, height) {
  context.save();
  context.fillStyle = "rgba(255, 250, 241, 0.92)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(105, 91, 73, 0.92)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `${Math.max(18, width * 0.022)}px Avenir Next, Segoe UI, sans-serif`;
  context.fillText("Image preview will appear here", width / 2, height / 2 - 14);
  context.font = `${Math.max(13, width * 0.014)}px Avenir Next, Segoe UI, sans-serif`;
  context.fillText("Upload or paste an image to begin.", width / 2, height / 2 + 22);
  context.restore();
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
