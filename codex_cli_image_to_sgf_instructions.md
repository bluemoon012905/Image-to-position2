# Codex CLI Instructions — Automatic Image-to-SGF Static Web App

## Overview

This document combines all instructions needed to guide Codex CLI in upgrading an older image-to-SGF web app into a more automatic, browser-only static web app for Go board recognition.

### Project goals

- Keep the app fully static-hostable with no backend
- Improve the older version that relies on user-clicked 4 corners and manual board size
- Add as much automatic detection as possible, while keeping manual fallback
- Upload an image, detect the Go board and stone positions, reconstruct a board state, allow manual correction, and export SGF
- Optimize for GitHub Pages or equivalent static hosting

---

## Recommended Codex CLI setup

In your repo:

```bash
git checkout -b feature/auto-image-to-sgf
git commit --allow-empty -m "checkpoint before codex work"
codex -m gpt-5.4
```

Use Git checkpoints before and after major steps.

---

## Technical constraints

Use these hard constraints for the implementation:

- Static hosting only. No backend, no server-side processing, no database.
- Everything must run in the browser.
- Deployment target is GitHub Pages or equivalent static hosting.
- The app must still work even if automatic detection fails.
- Manual fallback must remain available:
  - user can click 4 corners
  - user can set board size manually
  - user can edit board state manually
- Focus on single-position reconstruction, not move-history reconstruction.
- The output SGF may represent a setup position rather than inferred move order.
- The app should favor reliability and recoverability over “magic.”
- The code should be modular and debuggable.
- Add visible debug overlays for board bounds, grid intersections, and detected stones.
- Add a developer toggle panel to inspect intermediate image-processing stages.
- Avoid huge ML dependencies unless they are clearly justified and browser-friendly.

---

## What the app should do

Target behavior:

- static web app only
- browser-only processing
- no backend
- upload image
- automatically detect:
  - board region
  - board perspective
  - board size
  - stone positions
- then show an editor for corrections
- export `.sgf`
- keep fallback manual mode:
  - click 4 corners
  - choose board size

---

## Best way to drive Codex CLI

Do **not** ask Codex to “build everything” in one vague prompt.

Use a sequence of controlled prompts and require it to inspect first, then refactor, then add stages one at a time.

---

# Step 1 — inspect the repo and propose the architecture

Paste into Codex:

```text
Read this repository and understand the current image-to-SGF implementation.

My goals:
1. Keep the app fully static-hostable with no backend.
2. Improve the older version that relies on user-clicked 4 corners and manual board size.
3. Add as much automatic detection as possible, but keep manual fallback.
4. The final app should upload an image, detect the Go board and stone positions, reconstruct a board state, allow manual correction, and export SGF.

Please do the following before making changes:
- inspect the existing codebase structure
- identify the current image-processing pipeline
- identify where corner selection, board-size selection, and SGF export are implemented
- propose a staged architecture for:
  a. automatic board detection
  b. perspective rectification
  c. automatic board size detection
  d. stone classification at intersections
  e. interactive correction UI
  f. SGF export
- recommend the minimum set of libraries needed for a browser-only static app
- prefer simple browser-compatible tools and avoid adding a backend
- explain what should be reused from the current implementation and what should be replaced

Do not modify files yet. Just give me:
1. a repo audit
2. a proposed architecture
3. an implementation plan broken into small safe commits
4. technical risks and fallback plans
```

---

# Step 2 — tell Codex the technical constraints

Paste into Codex:

```text
Use these hard constraints for the implementation:

- Static hosting only. No backend, no server-side processing, no database.
- Everything must run in the browser.
- Deployment target is GitHub Pages or equivalent static hosting.
- The app must still work even if automatic detection fails.
- Manual fallback must remain available:
  - user can click 4 corners
  - user can set board size manually
  - user can edit board state manually
- Focus on single-position reconstruction, not move-history reconstruction.
- The output SGF may represent a setup position rather than inferred move order.
- The app should favor reliability and recoverability over “magic.”
- The code should be modular and debuggable.
- Add visible debug overlays for board bounds, grid intersections, and detected stones.
- Add a developer toggle panel to inspect intermediate image-processing stages.
- Avoid huge ML dependencies unless they are clearly justified and browser-friendly.

Please refine the implementation plan accordingly and identify the most practical browser-side stack.
```

---

# Step 3 — tell Codex exactly what pipeline to implement

Paste into Codex:

```text
Implement the image-to-SGF pipeline in this order of preference:

PHASE 1: Robust browser-only classical CV
1. Image upload
2. Preprocessing pipeline:
   - downscale for speed while keeping a full-resolution reference
   - grayscale
   - contrast normalization
   - optional blur / denoise
   - edge map / threshold views for debugging
3. Automatic board candidate detection:
   - find likely quadrilateral board region
   - score candidates by shape, line consistency, and expected grid behavior
4. Perspective rectification:
   - warp the detected board into a square top-down board image
5. Board size estimation:
   - estimate whether the board is 9x9, 13x13, or 19x19
   - if confidence is low, ask user to choose
6. Grid/intersection model:
   - compute intersection coordinates from the rectified board
7. Stone detection:
   - classify each intersection as empty, black, or white
   - include confidence per intersection
8. Build an editable board state
9. Export SGF

PHASE 2: Recovery UX
If any automatic step is uncertain:
- show fallback UI
- let the user adjust corners
- let the user change board size
- let the user click intersections to correct the board
- preserve all manual edits

PHASE 3: Confidence + debugging
Add:
- overlays for detected board boundary
- overlays for warped board
- overlays for intersection grid
- overlays for black/white/empty predictions
- confidence values and failure reasons where possible

Important:
- Build this as a pipeline with explicit stages and typed outputs between stages.
- Do not hide logic inside one giant function.
- Make each stage testable and replaceable.
```

---

# Step 4 — automation should be layered, not all-or-nothing

Paste into Codex:

```text
Design the app so that automation is layered, not all-or-nothing.

Required UX behavior:
- On upload, attempt full automatic detection first.
- If board detection confidence is high, proceed automatically.
- If board detection confidence is medium, show the detected corners and ask for confirmation or adjustment.
- If board size confidence is low, require manual board-size confirmation.
- If stone classification confidence is mixed, still build a board but visually mark uncertain intersections for user review.
- The user must always be able to:
  - re-run auto detection
  - switch to manual corner mode
  - change board size
  - correct stones by clicking
  - clear and redo the detection
- Manual mode and automatic mode should share the same downstream board model and SGF export path.

Please implement the state model so that automatic results and manual overrides are stored separately but merged cleanly for rendering/export.
```

---

# Step 5 — tell Codex what not to do

Paste into Codex:

```text
Avoid these traps:

- Do not build a backend API.
- Do not attempt move-history reconstruction from one image.
- Do not depend on cloud inference.
- Do not assume perfect lighting or perfect top-down photos.
- Do not try to infer every parameter from scratch if a user correction is faster and more reliable.
- Do not make the UI look finished before the pipeline is debuggable.
- Do not remove the existing working manual flow until the new path is validated.
- Do not replace the SGF exporter unless necessary; reuse it if possible.
```

---

# Step 6 — implement in small commits

Paste into Codex:

```text
Implement this in small reviewable steps.

For each step:
1. explain what files will change
2. make the changes
3. run the project if possible
4. summarize what works now
5. identify known limitations before proceeding

Use this order:
1. refactor current code into pipeline-friendly modules without changing behavior
2. add debug visualization panel and stage previews
3. add automatic board candidate detection
4. add perspective warp and rectified-board preview
5. add board-size estimation
6. add intersection-grid generation
7. add stone classification with confidence
8. merge automatic results into the existing editor
9. improve SGF output path for setup-position export
10. add tests or sample fixtures where practical
```

---

# Step 7 — preserve and integrate the old manual workflow

Paste into Codex:

```text
Preserve and integrate the current manual workflow.

Please:
- keep the existing 4-corner manual selection mode
- keep manual board-size selection
- reuse existing SGF export logic where possible
- route both automatic and manual flows into the same canonical board-state model
- avoid duplicate logic for board rendering and export

If the old code is tightly coupled, refactor carefully rather than rewriting everything at once.
```

---

# Step 8 — canonical board-state model

Paste into Codex:

```text
Create a canonical board-state model for the app.

The model should include:
- source image metadata
- detected board quadrilateral in source-image coordinates
- rectified board image metadata
- board size
- intersection coordinates
- automatic per-intersection classification:
  - empty / black / white
  - confidence
- manual overrides per intersection
- merged final board state for rendering/export
- pipeline diagnostics and confidence scores

The UI should render from the merged final board state.
The export should also use the merged final board state.
```

---

# Step 9 — stone classification strategy

Paste into Codex:

```text
For stone detection, start with a practical classical-CV approach rather than a large ML model.

Implement a browser-friendly per-intersection classifier that uses the rectified board and evaluates a small patch around each intersection.

Possible signals to combine:
- center brightness
- local contrast
- radial intensity differences
- edge density
- circularity-like cues
- comparison to nearby wood/background texture

Output:
- class = empty / black / white
- confidence score
- optional raw feature values for debugging

If the classifier is weak, structure it so a later small ONNX model could replace only the classification stage without changing the rest of the pipeline.
```

---

# Step 10 — build a debug-friendly UI

Paste into Codex:

```text
Build a debug-friendly UI, not just an end-user UI.

Required panels/views:
- original uploaded image
- detected board overlay
- rectified/warped board preview
- estimated grid overlay
- stone detection overlay
- final editable board
- confidence summary and warnings

Add toggles to:
- show/hide grid
- show/hide candidate corners
- show/hide confidence heatmap
- switch between automatic and manual adjustment mode
- re-run detection
```

---

# Step 11 — test fixtures and failure cases

Paste into Codex:

```text
Add support for development fixtures and repeatable testing.

Please:
- create a small sample-images folder or fixture structure if the repo does not already have one
- support loading built-in sample images in dev mode
- include examples of:
  - clean top-down board
  - mild perspective
  - difficult lighting
  - partially noisy board texture
- document expected behavior and known failure modes for each sample

Also add a short evaluation checklist for:
- board detection accuracy
- board size accuracy
- stone accuracy
- correction UX quality
- SGF validity
```

---

# Step 12 — write documentation

Paste into Codex:

```text
After implementation, write documentation that includes:

1. Overview of the pipeline
2. What is automatic vs manual
3. Known limitations
4. Recommended photo conditions
5. Development architecture
6. How to add or replace a pipeline stage
7. How SGF export works
8. How to deploy on static hosting
```

---

## Master prompt version

If you want one single Codex prompt instead of step-by-step, use this:

```text
Read this repository and upgrade it from a mostly manual image-to-SGF app into a more automatic browser-only static web app for Go board recognition.

Goals:
- static hosting only
- no backend
- keep old manual fallback
- automatically detect board, perspective, board size, and stone positions as much as possible
- show editable board and export SGF

Required behavior:
- user uploads an image
- app attempts automatic board detection
- app rectifies the board to a top-down square
- app estimates board size (9/13/19) with confidence
- app computes intersections
- app classifies intersections as empty/black/white with confidence
- app shows final editable board
- user can manually correct mistakes
- app exports a valid SGF representing the final board state
- if automation is uncertain, user can fall back to manual corner selection and manual board-size selection

Engineering requirements:
- browser-only implementation
- modular explicit pipeline stages
- typed outputs between stages
- debug visualizations for every stage
- confidence scoring and failure reasons
- no cloud inference
- no backend API
- do not remove working manual features
- refactor carefully and reuse the existing SGF export path when practical

Implementation order:
1. inspect repo and summarize current architecture
2. refactor existing logic into modular pipeline-friendly code
3. add debug panel and stage previews
4. add automatic board candidate detection
5. add perspective warp
6. add board-size estimation
7. add intersection generation
8. add per-intersection stone classification with confidence
9. merge with manual correction UI
10. validate SGF export
11. add sample fixtures and documentation

Important UX rules:
- automation should be layered, not all-or-nothing
- user must always be able to retry, adjust corners, change board size, and edit stones manually
- uncertain results should be visibly marked, not silently trusted

Stone-detection preference:
- start with classical CV using per-intersection patch classification
- keep the classifier replaceable so a later tiny ONNX model could be dropped in

Please work in small safe commits, explaining changes before each major step, and keep the app deployable on GitHub Pages.
```

---

## Strong recommendation

Use the step-by-step prompts instead of only the master prompt.

Codex usually performs better when you make it:

- inspect first
- refactor second
- add one CV stage at a time
- keep debug overlays visible

This improves reliability and keeps the project easier to recover if something breaks.

---

## Optional implementation guidance for the actual app

### Preferred approach

Start with **browser-only classical CV** and only add ML later if needed.

Recommended stack:

- OpenCV.js for preprocessing, contour detection, perspective warp, and geometric transforms
- Canvas APIs for rendering and overlays
- Existing board editor / SGF export logic where possible
- Optional later: ONNX Runtime Web only for a tiny intersection classifier replacement if classical CV is not enough

### Detection strategy

1. User uploads an image
2. Preprocess image
3. Detect candidate board quadrilateral
4. Warp to rectified top-down board image
5. Estimate board size
6. Compute all intersections mathematically
7. Classify each intersection
8. Build editable board state
9. Let user fix errors
10. Export SGF

### Why this is easier

This avoids trying to detect all stones freely in the original photo.  
Once the board is rectified, the geometry becomes predictable, and the classification problem becomes much simpler.

### Important fallback behavior

If board detection fails:
- switch to manual 4-corner mode

If board size is unclear:
- ask the user to choose 9x9, 13x13, or 19x19

If some intersections are uncertain:
- still produce a board
- mark uncertain spots for review
- let the user click to correct them

---

## Codex CLI usage tips

Helpful habits while using Codex CLI:

- make Git checkpoints often
- keep prompts specific and bounded
- require repo inspection before code changes
- ask for small commits
- keep working manual features intact until replacements are validated
- prioritize debug visibility over polished UI early

You can also use Codex session controls such as model switching and permissions as needed during development.

---

## Final note

The project should aim for **layered automation**, not perfect black-box magic.

The best version is one that:
- works automatically on many images
- fails gracefully on hard images
- makes manual correction easy
- always produces a usable SGF
