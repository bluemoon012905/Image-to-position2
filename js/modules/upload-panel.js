const IMAGE_TYPE_PREFIX = "image/";

export function createUploadPanel({
  browseButtonElement,
  panelElement,
  inputElement,
  pasteTargetElement,
  imageStore,
}) {
  if (
    !browseButtonElement ||
    !panelElement ||
    !inputElement ||
    !pasteTargetElement ||
    !imageStore
  ) {
    throw new Error(
      "Upload panel requires browse button, panel, input, paste target, and imageStore.",
    );
  }

  browseButtonElement.addEventListener("click", () => {
    inputElement.click();
  });

  panelElement.addEventListener("keydown", (event) => {
    if (event.target === pasteTargetElement) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputElement.click();
    }
  });

  pasteTargetElement.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  pasteTargetElement.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });

  inputElement.addEventListener("change", (event) => {
    const [file] = event.target.files ?? [];
    void handleFileSelection(file, "file picker", imageStore, pasteTargetElement);
    inputElement.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    panelElement.addEventListener(eventName, (event) => {
      event.preventDefault();
      panelElement.classList.add("is-dragging");
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    panelElement.addEventListener(eventName, (event) => {
      event.preventDefault();

      if (eventName === "dragleave" && panelElement.contains(event.relatedTarget)) {
        return;
      }

      panelElement.classList.remove("is-dragging");
    });
  });

  panelElement.addEventListener("drop", (event) => {
    const [file] = [...(event.dataTransfer?.files ?? [])];
    void handleFileSelection(file, "drag and drop", imageStore, pasteTargetElement);
  });

  pasteTargetElement.addEventListener("paste", (event) => {
    event.preventDefault();
    pasteTargetElement.value = "Checking clipboard for an image...";
    void handlePasteEvent(event, imageStore, pasteTargetElement);
  });
}

async function handleFileSelection(file, source, imageStore, pasteTargetElement) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith(IMAGE_TYPE_PREFIX)) {
    imageStore.clear();
    pasteTargetElement.value = "";
    return;
  }

  try {
    await imageStore.setImage(file, source);
  } catch (error) {
    imageStore.clear();
    pasteTargetElement.value = "Could not load that image. Try another paste or upload.";
    console.error(error);
  }
}

async function handlePasteEvent(event, imageStore, pasteTargetElement) {
  const directFile =
    findImageFileFromFiles(event.clipboardData?.files ?? []) ??
    findImageFileFromItems(event.clipboardData?.items ?? []);

  if (directFile) {
    pasteTargetElement.value = "Image pasted from clipboard.";
    await handleFileSelection(
      directFile,
      "clipboard paste",
      imageStore,
      pasteTargetElement,
    );
    return;
  }

  const fallbackFile = await readImageFromClipboardApi();

  if (fallbackFile) {
    pasteTargetElement.value = "Image pasted from clipboard.";
    await handleFileSelection(
      fallbackFile,
      "clipboard paste",
      imageStore,
      pasteTargetElement,
    );
    return;
  }

  pasteTargetElement.value =
    "No image found in the clipboard. Copy an image, then paste again.";
}

function findImageFileFromFiles(files) {
  for (const file of files) {
    if (file.type?.startsWith(IMAGE_TYPE_PREFIX)) {
      return file;
    }
  }

  return null;
}

function findImageFileFromItems(items) {
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith(IMAGE_TYPE_PREFIX)) {
      continue;
    }

    const file = item.getAsFile();

    if (file) {
      return file;
    }
  }

  return null;
}

async function readImageFromClipboardApi() {
  if (!navigator.clipboard?.read) {
    return null;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();

    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith(IMAGE_TYPE_PREFIX));

      if (!imageType) {
        continue;
      }

      const blob = await item.getType(imageType);
      const extension = imageType.split("/")[1] || "png";

      return new File([blob], `clipboard-image.${extension}`, { type: imageType });
    }
  } catch (error) {
    console.error("Clipboard API read failed.", error);
  }

  return null;
}
