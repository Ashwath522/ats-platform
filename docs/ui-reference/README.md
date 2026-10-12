# CoreLink Approved UI Reference Pack

This pack contains 24 approved UI reference screenshots in page order, the master implementation prompt, and a CSV manifest.

## Contents
- `assets/images/`: exact screenshot files copied without image editing; names are stable for implementation.
- `manifest.csv`: page number, role area, tab/page name, suggested route, original source filename, asset filename/path, and notes.
- `MASTER_IMPLEMENTATION_PROMPT.md`: complete prompt for implementing all pages in the existing CoreLink repository.
- `CoreLink_UI_Approved_Designs.pdf`: visual guide with each screenshot, its page/tab name, source filename, asset path, and the master prompt.

## Image usage
Use each screenshot as the reference for its matching route. Rebuild the page with real HTML/JSX and CSS; do not stretch a full screenshot as the entire page background. Use the approved asset path consistently anywhere that page's matching image/visual is needed. Keep the original reference screenshots unchanged.

## Important
Routes in `manifest.csv` are suggested route names. Inspect the existing app and preserve its current route conventions and authentication/API contracts.
