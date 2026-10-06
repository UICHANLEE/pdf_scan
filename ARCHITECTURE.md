# Local scanner MVP

`Prototype.tsx` owns the camera/review/library screens and one mutually exclusive sheet. The protected mobile runtime is preserved. No server-side document API is implemented or contacted.

## Processing and persistence

1. Camera frames or validated JPG/PNG/WEBP files become bounded JPEG images.
2. `vision.ts` estimates an edge quadrilateral, applies inverse homography and six filters. Unfiltered corrected originals remain available when changing filters. Book mode splits at the center.
3. `ocr.ts` serializes recognition requests and owns a disposable parent Web Worker. `ocr-worker.ts` loads the locally bundled Tesseract browser SDK and initializes its child worker with local Korean/English models. This avoids first-use worker dependency optimization/full reload during development. The parent can be terminated during initialization or recognition; each attempt is capped at 90 seconds.
4. OCR returns text, normalized confidence (0–1) and pixel-space line bounding boxes. Geometry-changing edits invalidate previous OCR.
5. `pdf.ts` loads only when exporting. It recompresses images, embeds a subset of the bundled Korean font, and uses an invisible searchable text layer aligned to OCR line boxes. `download.ts` handles bounded safe filenames and object URL cleanup independently of PDF libraries.
6. `storage.ts` uses versioned IndexedDB transactions. Documents include ID, title, tags, creation/update timestamps and pages (ID, original, processed image, filter, optional OCR). Searches match all terms across title/tags/OCR and sort by update time. Deletion removes the complete document record.
7. `book-enhancement.ts` loads on opening book cleanup. It analyzes an <=800px raster for bowed text rows and edge-connected skin-color components. Suggestions require explicit confirmation. Approved rectangles are filled in source coordinates first, then a bounded monotonic inverse vertical map straightens curvature; the final image is <=2200px. The panel requires a fresh preview before applying. A single `cleanupOriginal` baseline (optional page field, no IndexedDB migration needed) supports undo without chains of full-page copies. This field is validated and included in the existing 100MB storage cap. Applying/undoing invalidates OCR; rotating/cropping clears the now-incompatible undo baseline.

## Extension boundaries

Vision/OCR/PDF/storage interfaces are separate so a native or model-backed engine can replace one without changing the entire app. Pixel-space OCR boxes are associated with the processed page, not the raw photograph. External AI, auth, synchronization and encrypted storage require separately authorized architecture and key management; no API credentials are included in this repository.

## Known limitations

Browser origin persistence is not durable encrypted archival storage. Detection is heuristic, image processing runs on the main thread, storage search is linear, and Safari/mobile device coverage is not complete. Full 3D book geometry, occluded text reconstruction and complex layout understanding require further models and evaluation. Local curve/skin proposals are not a learned vision model. No RFP accuracy, latency or battery KPI is certified by the synthetic regression fixtures.
