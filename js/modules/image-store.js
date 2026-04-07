export function createImageStore({ fileNameElement, statusElement }) {
  const state = {
    file: null,
    height: 0,
    image: null,
    objectUrl: null,
    source: null,
    width: 0,
  };
  const subscribers = new Set();

  async function setImage(file, source) {
    releaseObjectUrl();

    const objectUrl = URL.createObjectURL(file);
    const image = await loadImage(objectUrl);

    state.file = file;
    state.height = image.naturalHeight;
    state.image = image;
    state.objectUrl = objectUrl;
    state.source = source;
    state.width = image.naturalWidth;

    fileNameElement.textContent = file.name;
    statusElement.textContent =
      `Loaded from ${source}. Ready for preview.`;
    statusElement.classList.add("is-ready");
    emit();
  }

  function clear() {
    releaseObjectUrl();

    state.file = null;
    state.height = 0;
    state.image = null;
    state.objectUrl = null;
    state.source = null;
    state.width = 0;

    fileNameElement.textContent = "No file selected";
    statusElement.textContent = "Waiting for an image.";
    statusElement.classList.remove("is-ready");
    emit();
  }

  function subscribe(listener) {
    subscribers.add(listener);
    listener(getState());

    return () => {
      subscribers.delete(listener);
    };
  }

  function emit() {
    const snapshot = getState();

    subscribers.forEach((listener) => {
      listener(snapshot);
    });
  }

  function releaseObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    clear,
    getState,
    subscribe,
    setImage,
  };
}

function loadImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = objectUrl;
  });
}
