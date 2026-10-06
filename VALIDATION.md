# Validation — 2026-10-06

Final checks performed by the primary model after integrating lower-tier agent contributions:

- `npm run build`: passed; entrypoint 505.22 kB (161.33 kB gzip), book enhancement engine 9.46 kB loaded on demand, OCR parent worker 0.96 kB with same-origin SDK assets, PDF library loaded separately on demand. Large-chunk warnings remain; no startup/low-memory performance certification is implied.
- `npm run check:runtime`: all 28 protected files unchanged.
- `npm run test:sites`: 4 packaging/Worker tests passed; no deployment performed.
- `npm run test:runtime -- --workers=1`: 43 browser tests passed in 57.1 seconds.
- `npm run test:production`: 9 built-app browser tests passed in 23.4 seconds, covering book-cleanup preview/apply/cancel/undo, stale-preview rejection, invalid-mask errors, OCR invalidation and persisted undo, iPhone/Pixel dialog layout, real import/edit, local save/reload/search/delete, multipage image PDF, and actual OCR/searchable PDF with no external network requests. These verify emitted worker paths and CSP under the production build.
- `npm audit`: zero known vulnerabilities, 157 dependency entries.
- `git diff --check`: passed.

## Covered behaviors

Real PNG import, grayscale/B&W filtering, color original, stable no-quad dimensions, rotation, page reorder/delete, book-mode split, 21-image rejection, malformed/unsupported input rejection, denied camera handling, virtual camera capture and track shutdown, IndexedDB save/reload/open/search/delete, OCR text persistence/search, actual bundled Korean/English recognition, bounded OCR initialization and retries, actual PDF/JPG/TXT download helpers, multipage PDF parsing, Korean Unicode searchable-text extraction with PDF.js, compression size reduction, and no external requests in the OCR/export path.

New local-book checks cover synthetic left/right bows with positive/negative displacement, inferred edge/sign and measured bending reduction, no curvature suggestion on straight/tilted/blank rows, edge-connected warm candidates versus central colored marks, actual approved-region paper fill and unrelated text preservation, no-op pixel tolerance, invalid geometry/type/size handling, preview-before-apply, edited-parameter preview invalidation, cancellation, undo, OCR invalidation and local baseline persistence/deletion. The fixtures are controlled tests, not a 3D dewarping or finger-detection accuracy benchmark.

A first full regression run exposed a development-only first-OCR page reset. Cold Vite-cache reproduction confirmed it and the fix uses the packaged browser SDK as a same-origin asset. Cold-cache OCR then passed without losing scan state; the final complete runs above passed after this change. Generated caches were moved to temporary backups during reproduction; no protected source/configuration was edited.

The preserved runtime tests also cover horizontal/vertical gesture arbitration, tap-versus-drag suppression, momentum, sheet exit animations, keyboard dismissal, Android navigation insets and route transitions.

The primary model visually inspected the app in the Codex in-app browser and exercised the local book sheet, manual curve controls and actual preview generation. The preview is local-only and remains available for inspection.

## Not covered / not certified

Tests use synthetic text/images, known OCR transcript fixtures for PDF extraction, and a virtual camera. They do not establish physical iPhone/Android camera behavior, flash availability, real-world OCR CER/WER, document detection rate, latency KPIs, full 3D book dewarping, learned finger segmentation, occluded-text or shadow reconstruction, durable encrypted storage, cloud operation, or production security certification. PDF Unicode-layer tests with supplied transcript data are distinct from tests running real OCR. The local fill tool is explicitly not secure redaction; undo originals remain stored.
