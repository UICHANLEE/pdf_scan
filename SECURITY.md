# Security review — 2026-10-03

## Scope

Application code, dependency advisories, document handling claims, static entrypoint policy, repository hygiene, and runtime preservation were reviewed. This is a UI prototype, not a production scanner or a penetration-test-certified product.

## Changes

- Patched transitive PostCSS to 8.5.28 and nanoid to 3.3.18 with exact npm overrides. These address the advisories reported by `npm audit` in the installed dependency tree.
- Restricted the HTML entrypoint with CSP: same-origin scripts/assets, no plugins, no form submissions, and no external connections. Local Vite WebSocket connections are allowed for development; inline styles remain necessary for the protected mobile runtime. Production deployments should additionally send CSP and `frame-ancestors` as HTTP headers.
- Added `no-referrer` policy and ignored environment files, private key files, logs, build outputs, and local QA captures in Git.
- Centralized scan transitions in a reducer, preventing duplicate capture completion and bounding a session to 20 pages. Page counts change only when simulated processing completes.
- Used a single mutually exclusive sheet state. Clipboard errors are handled; successful copy reflects an actual browser write.
- Removed fabricated OCR confidence and PDF-save success claims. Demo labels describe fixed samples and unimplemented processing clearly.

## Data handling

Post-patch `npm audit` reports zero known vulnerabilities across 125 dependency entries. The build and protected runtime integrity checks pass; browser regression tests cover page appending/selection, export disclosure, clipboard behavior, and mobile viewport layout.

Final validation: 12 browser tests passed, 4 packaging/worker tests passed, production build passed, and integrity checks passed for all 28 protected runtime files. The keyboard drag fixture now waits for opening motion and starts on footer padding instead of the input, preserving the runtime's intentional exclusion of text-editing gestures.

The application does not request device camera/gallery permissions or upload images. It uses a bundled generated sample and in-memory state. Sample text is written to the clipboard only after an explicit click. React renders text using its default escaping; the application does not inject HTML or evaluate user-provided code.

## Remaining production requirements

Real document processing needs input size/type validation, safe image decoding, processing timeouts, actual OCR/PDF implementations, privacy-aware storage/deletion, and test-set-based accuracy evaluation. Authentication, encryption, and authorization become necessary if cloud synchronization is implemented. Those capabilities are outside this cleanup.

Protected runtime source and deployment worker were preserved. Browser-only CSP does not substitute for deployment HTTP security headers.
