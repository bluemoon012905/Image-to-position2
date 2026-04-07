import { createImageStore } from "./modules/image-store.js";
import { createBoardPreview } from "./modules/board-preview.js";
import { createUploadPanel } from "./modules/upload-panel.js";

const imageStore = createImageStore({
  fileNameElement: document.querySelector("#selected-file-name"),
  statusElement: document.querySelector("#upload-status"),
});

createBoardPreview({
  boardCanvas: document.querySelector("#board-canvas"),
  helpElement: document.querySelector("#preview-help"),
  imageStore,
  statusElement: document.querySelector("#preview-status"),
});

createUploadPanel({
  browseButtonElement: document.querySelector("#browse-button"),
  panelElement: document.querySelector("#upload-panel"),
  inputElement: document.querySelector("#image-input"),
  pasteTargetElement: document.querySelector("#paste-target"),
  imageStore,
});
