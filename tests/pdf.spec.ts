import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function makeSearchablePdf(
  page: Page,
  quality: "high" | "compact" = "high",
) {
  return page.evaluate(async (selectedQuality) => {
    const module = await import(
      new URL("/src/scanner/pdf.ts", window.location.href).href
    );
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const image = canvas.toDataURL("image/jpeg", 0.96);
    const pdf = await module.createScanPdf(
      [
        {
          image,
          ocr: {
            text: "한글 문서 Quiet Scan 2026",
            lines: [
              {
                text: "한글 문서 Quiet Scan 2026",
                confidence: 0.99,
                bbox: { x0: 120, y0: 320, x1: 1420, y1: 480 },
              },
            ],
          },
        },
        {
          image,
          ocr: {
            text: "두 번째 페이지 검색 확인",
            lines: [],
          },
        },
      ],
      { searchable: true, quality: selectedQuality },
    );
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    return Array.from(bytes);
  }, quality);
}

async function extractAllText(bytes: number[]) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    const widths: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      widths.push(page.getViewport({ scale: 1 }).width);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return { pages, widths };
  } finally {
    await loadingTask.destroy();
  }
}

test("creates a searchable Korean multipage PDF readable by PDF.js", async ({
  page,
}) => {
  const bytes = await makeSearchablePdf(page);
  const { pages: extractedPages } = await extractAllText(bytes);

  expect(extractedPages).toHaveLength(2);
  expect(extractedPages[0]).toContain("한글 문서 Quiet Scan 2026");
  expect(extractedPages[1]).toContain("두 번째 페이지 검색 확인");
});

test("compact PDF output resizes and recompresses the source JPEG", async ({
  page,
}) => {
  const sizes = await page.evaluate(async () => {
    const module = await import(
      new URL("/src/scanner/pdf.ts", window.location.href).href
    );
    const canvas = document.createElement("canvas");
    canvas.width = 2600;
    canvas.height = 1700;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x < canvas.width; x += 16) {
      context.fillStyle = `rgb(${x % 255}, ${(x * 3) % 255}, ${(x * 7) % 255})`;
      context.fillRect(x, 0, 8, canvas.height);
    }
    const image = canvas.toDataURL("image/jpeg", 0.99);
    const [high, compact] = await Promise.all([
      module.createScanPdf([{ image }], { searchable: false, quality: "high" }),
      module.createScanPdf([{ image }], {
        searchable: false,
        quality: "compact",
      }),
    ]);
    return {
      highBytes: high.size,
      compactBytes: compact.size,
      highPdf: Array.from(new Uint8Array(await high.arrayBuffer())),
      compactPdf: Array.from(new Uint8Array(await compact.arrayBuffer())),
    };
  });
  const high = await extractAllText(sizes.highPdf);
  const compact = await extractAllText(sizes.compactPdf);

  expect(compact.widths[0]).toBeLessThan(high.widths[0]);
  expect(compact.widths[0]).toBeLessThanOrEqual(1200);
  expect(sizes.compactBytes).toBeLessThan(sizes.highBytes);
});

test("download helpers append MIME extensions and strip path characters", async ({
  page,
}) => {
  const suggestedNames: string[] = [];
  for (const mimeType of ["application/pdf", "text/plain"]) {
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(async (type) => {
      const module = await import(
        new URL("/src/scanner/download.ts", window.location.href).href
      );
      module.downloadBlob(new Blob(["fixture"], { type }), "../../한글 문서");
    }, mimeType);
    suggestedNames.push((await downloadPromise).suggestedFilename());
  }

  expect(suggestedNames[0]).toMatch(/\.pdf$/i);
  expect(suggestedNames[1]).toMatch(/\.txt$/i);
  expect(
    suggestedNames.every((name) => !name.includes("/") && !name.includes("\\")),
  ).toBe(true);
});
