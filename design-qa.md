# Design QA

> Historical visual review of the initial prototype. On 2026-10-03, security cleanup replaced misleading OCR confidence and PDF-save messages with explicit demo disclosures. The OCR/PDF items below describe tested UI simulation, not actual OCR recognition or PDF file creation. See README.md and SECURITY.md for the current supported behavior.

## Evidence

- Source visual truth: `/Users/uichan/workspace/pdf_parsing/design-source-option-1.png`
- Browser-rendered implementation: `/Users/uichan/workspace/pdf_parsing/implementation-camera-final.png`
- Combined comparison: `/Users/uichan/workspace/pdf_parsing/design-qa-comparison-final.png`
- Secondary flow capture: `/Users/uichan/workspace/pdf_parsing/implementation-review.png`
- State: initial camera screen, Book mode selected, flash off, document detected
- Browser viewport: `1800 x 1600` CSS px
- App viewport: `393 x 852` CSS px at deviceScaleFactor `1`
- Source pixels: `853 x 1844`, normalized to `393 x 852`
- Implementation pixels: `393 x 852`
- Density normalization: source was resampled to the exact implementation pixel size before side-by-side comparison

## Full-view comparison evidence

The final side-by-side comparison confirms the same dominant composition: warm overhead desk photography, centered open book, cobalt document boundary, quiet Korean title treatment, compact three-mode selector, and a large centered shutter. The implementation preserves the mobile template's status bar, home indicator, and device chrome as required; these are expected runtime differences from the content-only source.

## Focused comparison evidence

The title, document boundary, mode selector, shutter, and secondary controls are all legible at the normalized full-app size, so separate enlarged crops were not required. The final pass specifically checked title font/weight, detected-edge alignment, corner-handle size, segmented-control spacing, shutter proportions, and icon consistency.

## Required fidelity surfaces

- Fonts and typography: the camera title now uses a Korean serif stack with moderate weight, matching the source's editorial voice. Supporting labels use the runtime's clear product sans style. Hierarchy, wrapping, and line height are stable at `393px` width.
- Spacing and layout rhythm: the book remains the dominant middle region; title, scan target, mode selector, and shutter retain clear separation. Template-owned safe areas remain intact.
- Colors and visual tokens: near-black translucent controls, warm wood/paper neutrals, white text, and `#2581f6` scan blue align with the source palette and retain readable contrast.
- Image quality and asset fidelity: the dedicated full-resolution camera asset matches the source's overhead open-book scene and is placed as a real raster asset. Standard controls use Radix icons; there are no placeholder images, emoji, inline SVG artwork, or code-drawn substitute assets.
- Copy and content: the headline matches the source (`문서를 스캔하세요`). Book-mode guidance is kept in the supporting line, and RFP-required controls are labeled in Korean.

## Findings

No actionable P0, P1, or P2 mismatches remain.

The implementation intentionally adds close, flash, settings, detection status, and auto-capture controls because they are required by the supplied scanner RFP. The source does not show these controls, but they do not displace the core composition.

## Comparison history

1. Initial pass: P1 — the scan boundary began below the visible top edge of the book, weakening the automatic-detection affordance. Fixed by moving and resizing the Book-mode detection frame to align with the photographed page boundary. Post-fix evidence: `design-qa-comparison-final.png`.
2. Second pass: P2 — the title used a heavy sans-serif and mode-specific wording, losing the source's calm editorial hierarchy. Fixed with the Korean serif stack and source headline. Post-fix evidence: `design-qa-comparison-final.png`.

## Primary interactions tested

- Switch between Auto, Book, and Document capture modes
- Toggle flash
- Capture and wait for automatic processing
- Open the corrected multi-page review
- Apply the black-and-white filter
- Open OCR extraction and verify the recognized text state
- Open PDF export and save a searchable PDF
- Confirm the saved-success state

Browser console warnings/errors checked: none.

## Follow-up polish

- P3: the generated camera asset has a brighter plant and slightly denser book text than the source. This is acceptable for the current prototype and can be tuned in a future asset pass.

## Final result

final result: passed
