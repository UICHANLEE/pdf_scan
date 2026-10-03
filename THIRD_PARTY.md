# Bundled processing assets

These assets are served from the application origin. Document images and text are not transmitted to their publishers.

| Assets | Source | License |
| --- | --- | --- |
| `public/ocr/worker.min.js` | Installed `tesseract.js` 7.0.0 package | Apache-2.0; `public/ocr/LICENSE-tesseract-js.md` |
| `public/ocr/core/*` | Installed `tesseract.js-core` package | Apache-2.0; `public/ocr/LICENSE-core.txt` |
| `public/ocr/lang/{kor,eng}.traineddata.gz` | [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), gzip-compressed original models | Apache-2.0; `public/ocr/LICENSE-tessdata.txt` |
| `public/fonts/NotoSansKR.ttf` | [Google Fonts Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr), variable TTF | SIL Open Font License 1.1; `public/fonts/OFL.txt` |

JavaScript dependencies, versions and integrity hashes are recorded in `package-lock.json`. Their licenses remain in the installed packages. OCR has not been trained or benchmarked on this project's own evaluation corpus.
