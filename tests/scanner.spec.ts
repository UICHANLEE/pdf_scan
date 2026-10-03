import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "@playwright/test";

const databaseName = "quiet-capture-scans";

async function makeFixture(
  page: Page,
  label = "Quiet Scan document test 2026",
) {
  const dataUrl = await page.evaluate((text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 700;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    context.font = "bold 112px Arial, sans-serif";
    context.textBaseline = "middle";
    context.fillText(text, 90, canvas.height / 2);
    return canvas.toDataURL("image/png");
  }, label);

  return {
    name: "quiet-scan-fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  };
}

async function importFixture(page: Page, count = 1) {
  const payload = await makeFixture(page);
  await page
    .getByTestId("image-import")
    .setInputFiles(
      Array.from({ length: count }, (_, index) => ({
        ...payload,
        name: `quiet-scan-${index + 1}.png`,
      })),
    );
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${count}페이지`, exact: true }),
  ).toBeVisible();
}

async function clearDocuments(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("IndexedDB cleanup was blocked"));
      }),
    databaseName,
  );
}

async function downloadBytes(page: Page, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("The browser did not provide the downloaded file");
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await clearDocuments(page);
});

test("imports real images, applies a filter, rotates, reorders, and removes pages", async ({
  page,
}) => {
  await page.getByRole("button", { name: "문서", exact: true }).click();
  await importFixture(page, 2);

  const preview = page.locator(".actual-preview img");
  const originalDimensions = await preview.evaluate(
    (image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }),
  );

  await page.getByRole("button", { name: "흑백", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "흑백", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "페이지 회전" }).click();
  await expect
    .poll(async () => {
      const dimensions = await preview.evaluate((image: HTMLImageElement) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
      return (
        Math.abs(dimensions.width - originalDimensions.height) <= 2 &&
        Math.abs(dimensions.height - originalDimensions.width) <= 2
      );
    })
    .toBe(true);

  await page.getByRole("button", { name: "뒤로 이동", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2페이지", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "페이지 삭제" }).click();
  await expect(page.locator(".quality-badge")).toHaveText(/1페이지/);
  await expect(page.locator(".page-thumb")).toHaveCount(1);
});

test("saves locally, survives reload, searches, loads, and confirms deletion", async ({
  page,
}) => {
  const title = "조용한 스캔 문서 2026";
  await importFixture(page);
  await page.getByRole("button", { name: "문서 저장", exact: true }).click();
  await page.getByRole("textbox", { name: "문서 제목" }).fill(title);
  await page.getByRole("textbox", { name: "태그" }).fill("업무, 보관");
  await page.getByRole("button", { name: "기기에 저장", exact: true }).click();
  await expect(
    page.getByText("이 브라우저에 문서를 저장했어요."),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "내 문서", exact: true }).click();
  const search = page.getByRole("textbox", { name: "문서 검색" });
  await search.fill("보관");
  const savedDocument = page.getByRole("button").filter({ hasText: title });
  await expect(savedDocument).toBeVisible();
  await savedDocument.click();
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();
  await expect(page.locator(".page-thumb")).toHaveCount(1);

  await page.getByRole("button", { name: "내 문서 보기", exact: true }).click();
  await page
    .getByRole("button", { name: `${title} 삭제`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "문서를 삭제할까요?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "문서 삭제", exact: true }).click();
  await expect(page.getByText("저장된 문서가 없어요.")).toBeVisible();
});

test("rejects unsupported file types without leaving the camera view", async ({
  page,
}) => {
  await page.getByTestId("image-import").setInputFiles({
    name: "not-an-image.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 unsupported fixture"),
  });
  await expect(
    page.getByRole("heading", { name: "문서를 스캔하세요" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .getByText("JPG, PNG, WEBP 이미지 파일만 가져올 수 있습니다."),
  ).toBeVisible();
});

test("downloads a valid image PDF with the imported page count", async ({
  page,
}) => {
  await importFixture(page, 2);
  await page.getByRole("button", { name: "PDF 저장", exact: true }).click();
  const bytes = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "이미지 PDF 다운로드", exact: true })
      .click(),
  );

  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
});

test("runs real OCR and downloads a searchable PDF without external network requests", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const requestOrigins = new Set<string>();
  page.on("request", (request) => {
    try {
      requestOrigins.add(new URL(request.url()).origin);
    } catch {
      /* Ignore non-network URLs. */
    }
  });

  await importFixture(page);
  await page.getByRole("button", { name: "텍스트 추출", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "추출된 텍스트" }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Quiet/i)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "PDF 저장", exact: true }).click();
  const bytes = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "검색 가능한 PDF 다운로드", exact: true })
      .click(),
  );
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  const pdfSource = bytes.toString("latin1");
  expect(pdfSource).toContain("/ToUnicode");
  expect(pdfSource).toContain("/Font");
  expect([...requestOrigins]).toEqual([new URL(page.url()).origin]);
});

test("browser vision engine preserves no-quad size and color and thresholds both black and white", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { processImage } = await import("/src/scanner/vision.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#e53935";
    context.fillRect(0, 0, 160, 180);
    context.fillStyle = "#ffffff";
    context.fillRect(160, 0, 160, 180);
    context.fillStyle = "#000000";
    context.fillRect(160, 0, 160, 90);
    const source = canvas.toDataURL("image/png");
    const original = await processImage(source, undefined, "original");
    const binary = await processImage(source, undefined, "bw");
    const read = async (url: string) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const output = document.createElement("canvas");
      output.width = image.naturalWidth;
      output.height = image.naturalHeight;
      const outputContext = output.getContext("2d");
      if (!outputContext) throw new Error("Output canvas is unavailable");
      outputContext.drawImage(image, 0, 0);
      return {
        width: output.width,
        height: output.height,
        pixels: outputContext.getImageData(0, 0, output.width, output.height)
          .data,
      };
    };
    const color = await read(original);
    const thresholded = await read(binary);
    let darkest = 255;
    let brightest = 0;
    for (let offset = 0; offset < thresholded.pixels.length; offset += 4) {
      const gray =
        (thresholded.pixels[offset] +
          thresholded.pixels[offset + 1] +
          thresholded.pixels[offset + 2]) /
        3;
      darkest = Math.min(darkest, gray);
      brightest = Math.max(brightest, gray);
    }
    const redOffset = (40 * color.width + 40) * 4;
    return {
      width: color.width,
      height: color.height,
      red: [
        color.pixels[redOffset],
        color.pixels[redOffset + 1],
        color.pixels[redOffset + 2],
      ],
      darkest,
      brightest,
    };
  });

  expect(result).toMatchObject({ width: 320, height: 180 });
  expect(result.red[0]).toBeGreaterThan(result.red[1] + 80);
  expect(result.red[0]).toBeGreaterThan(result.red[2] + 80);
  expect(result.darkest).toBeLessThan(20);
  expect(result.brightest).toBeGreaterThan(235);
});

test("browser vision engine rejects a crossed document quadrilateral", async ({
  page,
}) => {
  const error = await page.evaluate(async () => {
    const { processImage } = await import("/src/scanner/vision.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await processImage(
        canvas.toDataURL("image/png"),
        [
          { x: 20, y: 20 },
          { x: 210, y: 150 },
          { x: 210, y: 20 },
          { x: 20, y: 150 },
        ],
        "original",
      );
      return "";
    } catch (caught) {
      return caught instanceof Error ? caught.message : String(caught);
    }
  });
  expect(error).toContain("볼록한 사각형");
});

test("book mode imports two pages and a 21-image batch stays on the camera screen", async ({
  page,
}) => {
  await page.getByRole("button", { name: "책", exact: true }).click();
  await importFixture(page, 1);
  await expect(page.locator(".page-thumb")).toHaveCount(2);
  await page.getByRole("button", { name: "촬영 화면으로 돌아가기" }).click();
  await page.getByTestId("image-import").setInputFiles(
    Array.from({ length: 21 }, (_, index) => ({
      name: `overflow-${index}.png`,
      mimeType: "image/png",
      buffer: Buffer.from("small fixture; rejected before decoding"),
    })),
  );
  await expect(
    page.getByRole("heading", { name: "문서를 스캔하세요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").getByText("문서당 20페이지를 초과했어요."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toHaveCount(0);
});

test("rejects a corrupted PNG with a recoverable message", async ({ page }) => {
  await page.getByTestId("image-import").setInputFiles({
    name: "corrupted.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not a PNG image"),
  });
  await expect(
    page.getByRole("heading", { name: "문서를 스캔하세요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").getByText(/이미지 파일을 읽지 못했습니다/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toHaveCount(0);
});

test("camera permission denial shows a safe notice without a page error", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
    });
  });
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect(page.locator(".camera-notice")).toContainText(
    /Permission denied|권한/,
  );
  expect(pageErrors).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "문서를 스캔하세요" }),
  ).toBeVisible();
});

test("saves OCR text and searches saved documents by title and recognized body", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = "OCR Archive 2026";
  await importFixture(page);
  await page.getByRole("button", { name: "텍스트 추출", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "추출된 텍스트" }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Quiet/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "문서 저장", exact: true }).click();
  await page.getByRole("textbox", { name: "문서 제목" }).fill(title);
  await page.getByRole("button", { name: "기기에 저장", exact: true }).click();
  await expect(
    page.getByRole("status").getByText("이 브라우저에 문서를 저장했어요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "내 문서 보기", exact: true }).click();

  const search = page.getByRole("textbox", { name: "문서 검색" });
  const savedDocument = page.getByRole("button").filter({ hasText: title });
  await search.fill("Quiet");
  await expect(savedDocument).toBeVisible();
  await search.fill("archive 2026");
  await expect(savedDocument).toBeVisible();
});

test("compact PDF export is smaller for a large image fixture", async ({
  page,
}) => {
  const payload = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    const pixels = context.createImageData(canvas.width, canvas.height);
    let state = 0x12345678;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const value = state >>> 24;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = (value * 3 + 19) & 255;
      pixels.data[offset + 2] = (value * 5 + 71) & 255;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    return {
      name: "large-noise-fixture.png",
      mimeType: "image/png",
      buffer: Array.from(
        atob(dataUrl.slice(dataUrl.indexOf(",") + 1)),
        (character) => character.charCodeAt(0),
      ),
    };
  });
  await page
    .getByTestId("image-import")
    .setInputFiles({ ...payload, buffer: Buffer.from(payload.buffer) });
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "PDF 저장", exact: true }).click();
  const highQuality = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "이미지 PDF 다운로드", exact: true })
      .click(),
  );
  await page.getByRole("button", { name: "PDF 저장", exact: true }).click();
  await page.getByRole("button", { name: "용량 줄이기", exact: true }).click();
  const compact = await downloadBytes(page, () =>
    page
      .getByRole("button", { name: "이미지 PDF 다운로드", exact: true })
      .click(),
  );
  expect(highQuality.length).toBeGreaterThan(100_000);
  expect(compact.length).toBeLessThan(highQuality.length);
});
