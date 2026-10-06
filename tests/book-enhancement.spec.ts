import { expect, test } from "@playwright/test";

const modulePath = "/src/scanner/book-enhancement.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("curve displacement flattens a synthetic bent baseline without changing page dimensions", async ({
  page,
}) => {
  const result = await page.evaluate(async (path) => {
    const { enhanceBookPage } = await import(path);
    const width = 800;
    const height = 600;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const context = sourceCanvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#111";
    context.beginPath();
    for (let x = 16; x < width - 16; x += 2) {
      const profile = Math.exp(-(x / (width - 1)) / 0.22);
      const y = 300 + 19.8 * profile;
      if (x === 16) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineWidth = 7;
    context.stroke();
    const source = sourceCanvas.toDataURL("image/png");
    const outputUrl = await enhanceBookPage(source, {
      curve: { amount: 0.55, edge: "left" },
      regions: [],
    });
    const output = new Image();
    output.src = outputUrl;
    await output.decode();
    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = output.naturalWidth;
    resultCanvas.height = output.naturalHeight;
    const resultContext = resultCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!resultContext) throw new Error("Output canvas is unavailable");
    resultContext.drawImage(output, 0, 0);
    const pixels = resultContext.getImageData(
      0,
      0,
      resultCanvas.width,
      resultCanvas.height,
    ).data;
    const bend = (
      imageWidth: number,
      imageHeight: number,
      data: Uint8ClampedArray,
    ) => {
      const positions: number[] = [];
      for (let x = 40; x < imageWidth - 40; x += 20) {
        let darkestY = 0;
        let darkest = 256;
        for (let y = imageHeight * 0.43; y < imageHeight * 0.57; y++) {
          const offset = (Math.floor(y) * imageWidth + x) * 4;
          const gray = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
          if (gray < darkest) {
            darkest = gray;
            darkestY = y;
          }
        }
        positions.push(darkestY);
      }
      const average =
        positions.reduce((sum, value) => sum + value, 0) / positions.length;
      const deviation = Math.sqrt(
        positions.reduce((sum, value) => sum + (value - average) ** 2, 0) /
          positions.length,
      );
      return deviation;
    };
    const sourcePixels = context.getImageData(0, 0, width, height).data;
    return {
      sourceBend: bend(width, height, sourcePixels),
      enhancedBend: bend(resultCanvas.width, resultCanvas.height, pixels),
      dimensions: [resultCanvas.width, resultCanvas.height],
    };
  }, modulePath);

  expect(result.dimensions).toEqual([800, 600]);
  expect(result.sourceBend).toBeGreaterThan(4);
  expect(result.enhancedBend).toBeLessThan(result.sourceBend * 0.65);
});

test("zero curve and no masks preserve visual pixels within JPEG tolerance", async ({
  page,
}) => {
  const result = await page.evaluate(async (path) => {
    const { enhanceBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f3e8cf";
    context.fillRect(0, 0, 120, 160);
    context.fillStyle = "#2860ba";
    context.fillRect(120, 0, 120, 160);
    context.fillStyle = "#222";
    context.fillRect(30, 45, 180, 9);
    const source = canvas.toDataURL("image/png");
    const outputUrl = await enhanceBookPage(source, {
      curve: { amount: 0, edge: "both" },
      regions: [],
    });
    const output = new Image();
    output.src = outputUrl;
    await output.decode();
    const actualCanvas = document.createElement("canvas");
    actualCanvas.width = output.naturalWidth;
    actualCanvas.height = output.naturalHeight;
    const actualContext = actualCanvas.getContext("2d");
    if (!actualContext) throw new Error("Output canvas is unavailable");
    actualContext.drawImage(output, 0, 0);
    const actual = actualContext.getImageData(
      0,
      0,
      actualCanvas.width,
      actualCanvas.height,
    ).data;
    const expected = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
    const offsets = [
      (20 * canvas.width + 20) * 4,
      (20 * canvas.width + 200) * 4,
      (45 * canvas.width + 90) * 4,
      (130 * canvas.width + 40) * 4,
      (130 * canvas.width + 200) * 4,
    ];
    return {
      dimensions: [actualCanvas.width, actualCanvas.height],
      deltas: offsets.flatMap((offset) =>
        [0, 1, 2].map((channel) =>
          Math.abs(actual[offset + channel] - expected[offset + channel]),
        ),
      ),
    };
  }, modulePath);

  expect(result.dimensions).toEqual([240, 160]);
  expect(Math.max(...result.deltas)).toBeLessThanOrEqual(18);
});

test("an approved edge skin region is replaced with paper while separate black text stays dark", async ({
  page,
}) => {
  const result = await page.evaluate(async (path) => {
    const { enhanceBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f7f4ed";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#b87b61";
    context.fillRect(18, 95, 145, 210);
    context.fillStyle = "#111";
    context.fillRect(250, 145, 285, 12);
    context.fillRect(250, 190, 260, 12);
    const source = canvas.toDataURL("image/png");
    const outputUrl = await enhanceBookPage(source, {
      curve: { amount: 0, edge: "left" },
      regions: [
        {
          id: "approved-left-skin",
          x: 0.03,
          y: 0.24,
          width: 0.21,
          height: 0.52,
        },
      ],
    });
    const output = new Image();
    output.src = outputUrl;
    await output.decode();
    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = output.naturalWidth;
    resultCanvas.height = output.naturalHeight;
    const resultContext = resultCanvas.getContext("2d");
    if (!resultContext) throw new Error("Output canvas is unavailable");
    resultContext.drawImage(output, 0, 0);
    const pixels = resultContext.getImageData(
      0,
      0,
      resultCanvas.width,
      resultCanvas.height,
    ).data;
    const pixel = (x: number, y: number) => {
      const offset = (y * resultCanvas.width + x) * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    };
    return {
      paper: pixel(70, 180),
      text: pixel(320, 150),
      dimensions: [resultCanvas.width, resultCanvas.height],
    };
  }, modulePath);

  expect(result.dimensions).toEqual([600, 400]);
  expect(Math.min(...result.paper)).toBeGreaterThan(220);
  expect(Math.max(...result.text)).toBeLessThan(60);
});

test("book analysis does not suggest a central colored logo as a removal region", async ({
  page,
}) => {
  const analysis = await page.evaluate(async (path) => {
    const { analyzeBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f5f0e5";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#d43176";
    context.fillRect(335, 245, 130, 110);
    context.fillStyle = "#222";
    context.fillRect(190, 170, 420, 10);
    context.fillRect(190, 205, 400, 10);
    const result = await analyzeBookPage(canvas.toDataURL("image/png"));
    return {
      curve: result.curve,
      regions: result.regions,
      warnings: result.warnings,
    };
  }, modulePath);

  expect(Array.isArray(analysis.regions)).toBe(true);
  expect(analysis.regions.length).toBeLessThanOrEqual(6);
  expect(Array.isArray(analysis.warnings)).toBe(true);
  const logo = {
    x: 335 / 800,
    y: 245 / 600,
    width: 130 / 800,
    height: 110 / 600,
  };
  const overlappingLogoRegions = analysis.regions.filter(
    (region: { x: number; y: number; width: number; height: number }) =>
      region.x < logo.x + logo.width &&
      region.x + region.width > logo.x &&
      region.y < logo.y + logo.height &&
      region.y + region.height > logo.y,
  );
  expect(overlappingLogoRegions).toEqual([]);
});

test("invalid masks and an unreadable source are rejected", async ({
  page,
}) => {
  const result = await page.evaluate(async (path) => {
    const { enhanceBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL("image/png");
    const regions = [
      { id: "nan", x: Number.NaN, y: 0.2, width: 0.1, height: 0.2 },
      { id: "outside", x: -0.05, y: 0.2, width: 0.1, height: 0.2 },
      { id: "too-large", x: 0, y: 0, width: 1, height: 1 },
    ];
    const rejected: boolean[] = [];
    for (const region of regions) {
      try {
        await enhanceBookPage(source, { curve: null, regions: [region] });
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    let badSourceRejected = false;
    try {
      await enhanceBookPage("/missing-book-scan.jpg", {
        curve: null,
        regions: [],
      });
    } catch {
      badSourceRejected = true;
    }
    return { rejected, badSourceRejected };
  }, modulePath);

  expect(result.rejected).toEqual([true, true, true]);
  expect(result.badSourceRejected).toBe(true);
});
