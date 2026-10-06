# Security review — 2026-10-06

The primary model reviewed the lower-tier agents' vision, PDF, storage and book-enhancement implementations and performed the integration/refactoring. This is a local browser MVP, not a penetration-test-certified or native production scanner.

## Applied protections

- Same-origin CSP for scripts, model files, fonts and connections; explicitly scoped Web Worker/WASM support. No external OCR/LLM/document-upload endpoint. Runtime tests verify the OCR/export flow makes no external-origin requests.
- React text escaping; no user HTML injection or eval. A single sheet state, busy guard and atomic image-batch import prevent competing operations or partial imports.
- Camera is requested only after a click, without audio. Tracks stop on navigation and unmount. Unsupported flash and denied permission produce recoverable notices. Automated camera tests use a virtual device, not the user's physical camera.
- JPG/PNG/WEBP allowlist, 15 MB file limit, decoded 30 MP limit, 2200px processing cap, convex in-bounds crop coordinates, maximum 20 pages, 100 MB aggregate storage/export image limits, and 250,000-character OCR storage limit.
- OCR executes in a disposable parent worker with a 90-second deadline. Initialization hangs terminate the worker tree and release the serial queue. Confidence is normalized to 0–1, and crop/rotation/filter edits invalidate OCR coordinates.
- Unfiltered corrected images are retained to prevent accumulating filter damage; transparent imported PNGs are composited on white. Degenerate crop quads are rejected and thresholding retains both black/white pixels.
- IndexedDB writes resolve only after transaction commit, failed opens can retry, and version changes release connections. A blocked open that later succeeds is closed. Document deletion removes image and OCR fields together.
- Download names remove path/control characters, receive the actual MIME extension, and object URLs are revoked. Korean fonts are subset-embedded; rejected font loads can retry. PDF libraries load on demand.
- `.gitignore` excludes credentials, local environment files, build outputs, test artifacts and QA captures. Existing exact PostCSS/nanoid overrides remain. Bundled asset licenses are preserved.
- Book cleanup accepts bounded local JPEG/PNG data URLs only. Analysis is capped at an 800px raster and edits at 2200px; curve displacement is bounded to 6% of page height and monotonic in source y. Skin-color suggestions require explicit selection; no automatic deletion, cloud inference or new runtime model downloads were added.
- Mask input requires finite in-bounds coordinates, unique IDs, no overlap, <=6 rectangles, <=15% area each and <=25% combined. Insufficient nearby bright-paper samples reject the edit instead of fabricating a background. A fresh preview is required after every parameter change. The primary model corrected per-row curve regression and added a straight-tilt comparison; signed synthetic bows and tilted straight rows are covered by tests.
- A single validated `cleanupOriginal` backup is included in the existing 100MB document cap. Applying/undoing invalidates OCR; rotation/cropping discards a now-incompatible backup. The UI explicitly states that masking does not reconstruct text and is not secure personal-data redaction: feathered boundaries and retained originals prevent that claim.
- The 2026-10-06 advisory check found [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) in transitive source-map-js 1.2.1. It was updated and pinned to 1.2.2 without install scripts; the subsequent advisory check reports zero known vulnerabilities.
- Cold-cache testing reproduced a development-only session reset on first OCR initialization. The parent worker now imports the installed package's bundled browser SDK from `/ocr/tesseract.esm.min.js`, avoiding late dev-worker dependency optimization. The file is same-origin and ships with its license notices. Cold-cache OCR then passed without losing pages; no protected runtime/build configuration was modified.

## Validation

Production build, 28-file protected-runtime integrity check and Sites/worker packaging tests are preserved. Browser tests cover virtual camera lifecycle, real image processing/import rejection, page management, local save/reload/search/delete, actual Korean/English OCR, OCR initialization timeout/retry, compact PDF size reduction, and Korean searchable PDF extraction with PDF.js. New engine/UI/storage tests cover signed synthetic curve flattening, flat/tilted-row rejection, edge color candidates versus central marks, approved region fill, invalid inputs, preview/undo/OCR invalidation, persistent baselines, and iPhone/Pixel dialog layout. Built-app browser tests exercise the cleanup flow as well as existing OCR/PDF paths. See `VALIDATION.md` for final run counts.

`npm audit` reports zero known vulnerabilities after the source-map-js patch at this review date. This is a registry advisory check, not a guarantee against unknown vulnerabilities or a model accuracy evaluation.

## Remaining risks / production requirements

IndexedDB content is not encrypted and can be read by same-origin code or anyone with access to the browser profile. Browser data eviction can delete documents; export important files as backups. No authentication, secure key management or cloud sync is present. Camera remains active while the camera screen is shown; the settings screen offers camera shutdown.

Image dimensions are checked after browser decode, so input limits do not eliminate every decoder-memory risk. Main-thread perspective processing can delay UI on low-end hardware. The camera permission prompt itself is browser-managed and may remain open until the user responds.

Production hosting must additionally send CSP, frame-ancestors and appropriate HTTP security headers; HTML meta CSP is not a complete deployment policy. Inline styles are needed by the protected runtime; WASM is needed by OCR. Development WebSocket allowances should be removed from production header policy. Real mobile cameras, Safari compatibility, 500–1,000-image accuracy benchmarks, low-memory behavior and battery use remain to be evaluated. No accuracy/confidentiality certification is claimed.
