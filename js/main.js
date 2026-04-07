import { createImageStore } from "./modules/image-store.js";
import { createBoardPreview } from "./modules/board-preview.js";
import { createUploadPanel } from "./modules/upload-panel.js";

const imageStore = createImageStore({
  fileNameElement: document.querySelector("#selected-file-name"),
  statusElement: document.querySelector("#upload-status"),
});

createBoardPreview({
  autoDetectButton: document.querySelector("#auto-detect-button"),
  boardCanvas: document.querySelector("#board-canvas"),
  debugElement: document.querySelector("#detector-debug"),
  helpElement: document.querySelector("#board-detection-help"),
  imageStore,
  manualDrawButton: document.querySelector("#manual-draw-button"),
  resetOutlineButton: document.querySelector("#reset-outline-button"),
  statusElement: document.querySelector("#board-detection-status"),
  summaryElement: document.querySelector("#outline-summary"),
});

createUploadPanel({
  browseButtonElement: document.querySelector("#browse-button"),
  panelElement: document.querySelector("#upload-panel"),
  inputElement: document.querySelector("#image-input"),
  pasteTargetElement: document.querySelector("#paste-target"),
  imageStore,
});
