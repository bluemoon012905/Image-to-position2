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
  boardSizeSelect: document.querySelector("#board-size-select"),
  boardStateSummaryElement: document.querySelector("#board-state-summary"),
  clearCornersButton: document.querySelector("#clear-corners-button"),
  clearStonesButton: document.querySelector("#clear-stones-button"),
  debugPanelElement: document.querySelector("#debug-panel"),
  debugStageGridElement: document.querySelector("#debug-stage-grid"),
  debugTextElement: document.querySelector("#debug-text"),
  debugToggleElement: document.querySelector("#debug-toggle"),
  editorCanvas: document.querySelector("#editor-canvas"),
  exportSgfButton: document.querySelector("#export-sgf-button"),
  helpElement: document.querySelector("#preview-help"),
  imageStore,
  manualCornersButton: document.querySelector("#manual-corners-button"),
  pipelineSummaryElement: document.querySelector("#pipeline-summary"),
  sgfOutputElement: document.querySelector("#sgf-output"),
  statusElement: document.querySelector("#preview-status"),
});

createUploadPanel({
  browseButtonElement: document.querySelector("#browse-button"),
  panelElement: document.querySelector("#upload-panel"),
  inputElement: document.querySelector("#image-input"),
  pasteTargetElement: document.querySelector("#paste-target"),
  imageStore,
});
