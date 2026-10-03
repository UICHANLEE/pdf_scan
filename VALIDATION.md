# Validation — 2026-10-04

Final checks performed by the primary model after integrating lower-tier agent contributions:

- `npm run build`: passed; entrypoint 496.95 kB (159.07 kB gzip), PDF library loaded separately on demand. The PDF chunk remains large; no startup/low-memory performance certification is implied.
- `npm run check:runtime`: all 28 protected files unchanged.
- `npm run test:sites`: 4 packaging/Worker tests passed; no deployment performed.
- `npm run test:runtime -- --workers=1`: 26 browser tests passed in 41.6 seconds.
- `npm audit`: zero known vulnerabilities, 157 dependency entries.
- `git diff --check`: passed.

## Covered behaviors

Real PNG import, grayscale/B&W filtering, color original, stable no-quad dimensions, rotation, page reorder/delete, book-mode split, 21-image rejection, malformed/unsupported input rejection, denied camera handling, virtual camera capture and track shutdown, IndexedDB save/reload/open/search/delete, OCR text persistence/search, actual bundled Korean/English recognition, bounded OCR initialization and retries, actual PDF/JPG/TXT download helpers, multipage PDF parsing, Korean Unicode searchable-text extraction with PDF.js, compression size reduction, and no external requests in the OCR/export path.

The preserved runtime tests also cover horizontal/vertical gesture arbitration, tap-versus-drag suppression, momentum, sheet exit animations, keyboard dismissal, Android navigation insets and route transitions.

The primary model visually inspected the app in the Codex in-app browser, corrected image-fit/overlay style conflicts, and exercised the sample scan and manual-crop flow. The preview is local-only and remains available for inspection.

## Not covered / not certified

Tests use synthetic text images, known OCR transcript fixtures for PDF extraction, and a virtual camera. They do not establish physical iPhone/Android camera behavior, flash availability, real-world OCR CER/WER, document detection rate, latency KPIs, book curvature correction, shadow/finger removal, durable encrypted storage, cloud operation, or production security certification. PDF Unicode-layer tests with supplied transcript data are distinct from the tests running real OCR.
