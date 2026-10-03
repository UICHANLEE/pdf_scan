import {
  PDFDocument,
  TextRenderingMode,
  beginText,
  endText,
  setFontAndSize,
  setTextRenderingMode,
  setTextMatrix,
  showText,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type ScanOcrLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type ScanPdfPage = {
  image: string;
  ocr?: { text: string; lines: ScanOcrLine[] };
};

export type ScanPdfOptions = {
  searchable: boolean;
  quality: "high" | "compact";
};

const MAX_PAGES = 20;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIDE = 12_000;
const MAX_PAGE_SIDE = 14_400;
const FONT_URL = "/fonts/NotoSansKR.ttf";
const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";

let koreanFontBytes: Promise<ArrayBuffer> | undefined;

function estimateJpegBytes(dataUrl: string): number {
  if (!dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) {
    throw new TypeError("Each scan must be a base64 JPEG data URL.");
  }
  const encodedLength = dataUrl.length - JPEG_DATA_URL_PREFIX.length;
  return Math.floor((encodedLength * 3) / 4);
}

function decodeJpegDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/i.exec(dataUrl);
  if (!match) throw new TypeError("Each scan must be a base64 JPEG data URL.");

  if (estimateJpegBytes(dataUrl) > MAX_IMAGE_BYTES) {
    throw new RangeError("A scan image exceeds the 40 MB limit.");
  }
  const binary = atob(match[1]);
  if (binary.length === 0 || binary.length > MAX_IMAGE_BYTES) {
    throw new RangeError("A scan image is empty or exceeds the 40 MB limit.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function prepareJpeg(
  dataUrl: string,
  quality: ScanPdfOptions["quality"],
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const sourceBytes = decodeJpegDataUrl(dataUrl);
  const sourceBuffer = new Uint8Array(sourceBytes.length);
  sourceBuffer.set(sourceBytes);
  const bitmap = await createImageBitmap(
    new Blob([sourceBuffer.buffer], { type: "image/jpeg" }),
  );
  try {
    safeImageSize(bitmap.width, bitmap.height);
    const maxSide = quality === "compact" ? 1_200 : 2_200;
    const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context)
      throw new Error(
        "This browser cannot prepare scan images for PDF export.",
      );
    context.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not encode a scan as JPEG.")),
        "image/jpeg",
        quality === "compact" ? 0.68 : 0.9,
      );
    });
    return {
      bytes: new Uint8Array(await jpeg.arrayBuffer()),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function safeImageSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > 50_000_000
  ) {
    throw new RangeError("A scan image has unsupported dimensions.");
  }

  // One PDF point per source pixel until the page-side limit is reached.
  const scale = Math.min(1, MAX_PAGE_SIDE / width, MAX_PAGE_SIDE / height);
  return { width: width * scale, height: height * scale };
}

function loadKoreanFont(): Promise<ArrayBuffer> {
  if (!koreanFontBytes) {
    koreanFontBytes = fetch(FONT_URL, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            `Could not load the Korean PDF font (${response.status}).`,
          );
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        koreanFontBytes = undefined;
        throw error;
      });
  }
  return koreanFontBytes;
}

function normalizedBox(
  line: ScanOcrLine,
  imageWidth: number,
  imageHeight: number,
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const values = [line.bbox?.x0, line.bbox?.y0, line.bbox?.x1, line.bbox?.y1];
  if (!values.every(Number.isFinite)) return undefined;

  const isNormalized = values.every((value) => value >= 0 && value <= 1);
  const xScale = isNormalized ? 1 : imageWidth;
  const yScale = isNormalized ? 1 : imageHeight;
  const x0 = Math.max(0, Math.min(1, line.bbox.x0 / xScale));
  const y0 = Math.max(0, Math.min(1, line.bbox.y0 / yScale));
  const x1 = Math.max(0, Math.min(1, line.bbox.x1 / xScale));
  const y1 = Math.max(0, Math.min(1, line.bbox.y1 / yScale));
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x0, y0, x1, y1 };
}

function fallbackTextLines(text: string): string[] {
  // OCR engines sometimes return a page transcript without line boxes. Split it
  // into conservative display-width chunks so the invisible layer remains searchable.
  const rows: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const chars = Array.from(paragraph.trim());
    if (chars.length === 0) continue;
    for (let offset = 0; offset < chars.length; offset += 36) {
      rows.push(chars.slice(offset, offset + 36).join(""));
    }
  }
  return rows;
}

function addInvisibleText(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  ocr: NonNullable<ScanPdfPage["ocr"]>,
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
): void {
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const drawInvisible = (
    text: string,
    x: number,
    y: number,
    size: number,
    targetWidth: number,
  ) => {
    const measuredWidth = font.widthOfTextAtSize(text, size);
    const horizontalScale = measuredWidth > 0 ? targetWidth / measuredWidth : 1;
    page.pushOperators(
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(fontKey, size),
      setTextMatrix(horizontalScale, 0, 0, 1, x, y),
      // Font encoding uses a hex string so embedded Korean glyphs stay intact.
      showText(font.encodeText(text)),
      endText(),
    );
  };
  const lines = ocr.lines.filter(
    (line) => typeof line.text === "string" && line.text.trim(),
  );

  if (lines.length > 0) {
    for (const line of lines) {
      const box = normalizedBox(line, imageWidth, imageHeight);
      if (!box) continue;
      const width = (box.x1 - box.x0) * pageWidth;
      const height = (box.y1 - box.y0) * pageHeight;
      const fontSize = Math.max(1, Math.min(height * 0.9, 96));
      drawInvisible(
        line.text,
        box.x0 * pageWidth,
        pageHeight -
          box.y1 * pageHeight +
          Math.max(0, (height - fontSize) * 0.12),
        fontSize,
        width,
      );
    }
    return;
  }

  const rows = fallbackTextLines(ocr.text);
  if (rows.length === 0) return;
  const fontSize = Math.max(
    0.5,
    Math.min(pageWidth / 42, pageHeight / (rows.length * 1.35 + 2), 18),
  );
  const lineHeight = Math.min(
    fontSize * 1.35,
    pageHeight / Math.max(1, rows.length),
  );
  rows.forEach((text, index) => {
    const width = font.widthOfTextAtSize(text, fontSize);
    drawInvisible(
      text,
      0,
      pageHeight - fontSize - index * lineHeight,
      fontSize,
      Math.min(width, pageWidth),
    );
  });
}

export async function createScanPdf(
  pages: ScanPdfPage[],
  options: ScanPdfOptions,
): Promise<Blob> {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) {
    throw new RangeError(
      `A PDF must contain between 1 and ${MAX_PAGES} scan pages.`,
    );
  }
  const estimatedTotalImageBytes = pages.reduce(
    (total, page) => total + estimateJpegBytes(page.image),
    0,
  );
  if (estimatedTotalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new RangeError("Scan images exceed the 100 MB total export limit.");
  }
  if (options.searchable && pages.some((page) => !page.ocr)) {
    throw new Error(
      "Searchable PDF export requires extracted OCR text for every page.",
    );
  }

  const pdf = await PDFDocument.create();
  let font: Awaited<ReturnType<PDFDocument["embedFont"]>> | undefined;
  if (options.searchable) {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(await loadKoreanFont(), { subset: true });
  }

  for (const scan of pages) {
    const prepared = await prepareJpeg(scan.image, options.quality);
    const image = await pdf.embedJpg(prepared.bytes);
    const size = safeImageSize(image.width, image.height);
    const page = pdf.addPage([size.width, size.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });

    if (options.searchable && scan.ocr && font) {
      addInvisibleText(
        page,
        font,
        scan.ocr,
        prepared.width,
        prepared.height,
        size.width,
        size.height,
      );
    }
  }

  const bytes = await pdf.save({
    useObjectStreams: options.quality === "compact",
  });
  // A copied ArrayBuffer makes the Blob input independent of typed-array
  // implementations whose backing buffer may be SharedArrayBuffer.
  const output = new Uint8Array(bytes.length);
  output.set(bytes);
  return new Blob([output.buffer], { type: "application/pdf" });
}
