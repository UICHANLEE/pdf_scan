import { expect, test, type Page } from "@playwright/test";

const modulePath = "/src/scanner/book-enhancement.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function synthesizeCurvedPage(
  page: Page,
  edge: "left" | "right",
  knownAmount = 0.34,
) {
  return page.evaluate(
    async ({ path, edgeName, curveAmount }) => {
      const { analyzeBookPage, enhanceBookPage } = await import(path);
      const width = 800;
      const height = 900;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#111";

      const profile = (x: number) => {
        const position = x / (width - 1);
        if (edgeName === "left") return Math.exp(-position / 0.22);
        return Math.exp(-(1 - position) / 0.22);
      };
      const baselines = [185, 285, 385, 485, 585, 685];
      for (const baseline of baselines) {
        const amplitude =
          curveAmount *
          0.06 *
          height *
          Math.sin((Math.PI * baseline) / (height - 1));
        for (let x = 60; x < width - 60; x += 15) {
          const y = Math.round(baseline + amplitude * profile(x));
          // Repeated short printed strokes make each text row detectable in every x band.
          context.fillRect(x, y, 9, 7);
        }
      }

      const source = canvas.toDataURL("image/png");
      const analysis = await analyzeBookPage(source);
      let enhancedBend: number | null = null;
      const sourcePixels = context.getImageData(0, 0, width, height).data;
      const bendOf = (
        data: Uint8ClampedArray,
        imageWidth: number,
        imageHeight: number,
      ) => {
        const measured: number[] = [];
        const baseline = baselines[3];
        for (let x = 75; x < imageWidth - 75; x += 30) {
          let darkestY = baseline;
          let darkest = 256;
          for (let y = baseline - 28; y <= baseline + 28; y++) {
            const offset = (y * imageWidth + x) * 4;
            const gray =
              (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
            if (gray < darkest) {
              darkest = gray;
              darkestY = y;
            }
          }
          measured.push(darkestY);
        }
        const average =
          measured.reduce((sum, value) => sum + value, 0) / measured.length;
        return Math.sqrt(
          measured.reduce((sum, value) => sum + (value - average) ** 2, 0) /
            measured.length,
        );
      };
      const sourceBend = bendOf(sourcePixels, width, height);
      let outputSize: number[] | null = null;
      if (analysis.curve) {
        const outputUrl = await enhanceBookPage(source, {
          curve: analysis.curve,
          regions: [],
        });
        const outputImage = new Image();
        outputImage.src = outputUrl;
        await outputImage.decode();
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = outputImage.naturalWidth;
        outputCanvas.height = outputImage.naturalHeight;
        const outputContext = outputCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!outputContext) throw new Error("Output canvas is unavailable");
        outputContext.drawImage(outputImage, 0, 0);
        const data = outputContext.getImageData(
          0,
          0,
          outputCanvas.width,
          outputCanvas.height,
        ).data;
        enhancedBend = bendOf(data, outputCanvas.width, outputCanvas.height);
        outputSize = [outputCanvas.width, outputCanvas.height];
      }
      return {
        curve: analysis.curve,
        warnings: analysis.warnings,
        sourceBend,
        enhancedBend,
        outputSize,
      };
    },
    { path: modulePath, edgeName: edge, curveAmount: knownAmount },
  );
}

test("estimates left and right bowed baselines with the correct edge/sign and reduces bending", async ({
  page,
}) => {
  for (const { edge, amount } of [
    { edge: "left" as const, amount: 0.34 },
    { edge: "right" as const, amount: 0.34 },
    { edge: "left" as const, amount: -0.34 },
    { edge: "right" as const, amount: -0.34 },
  ]) {
    const result = await synthesizeCurvedPage(page, edge, amount);
    expect(
      result.curve,
      `${edge} edge, amount ${amount} suggestion`,
    ).not.toBeNull();
    expect(result.curve?.edge).toBe(edge);
    expect(Math.sign(result.curve?.amount ?? 0)).toBe(Math.sign(amount));
    expect(Math.abs(result.curve?.amount ?? 0)).toBeGreaterThan(0.12);
    expect(Math.abs(result.curve?.amount ?? 0)).toBeLessThan(0.9);
    expect(result.enhancedBend).not.toBeNull();
    expect(result.enhancedBend!).toBeLessThan(result.sourceBend * 0.8);
    expect(result.enhancedBend!).toBeLessThan(8);
    expect(result.outputSize).toEqual([800, 900]);
  }
});

test("straight printed baselines and blank pages do not receive curve suggestions", async ({
  page,
}) => {
  const result = await page.evaluate(async (path) => {
    const { analyzeBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111";
    for (const y of [185, 285, 385, 485, 585, 685]) {
      for (let x = 60; x < canvas.width - 60; x += 15)
        context.fillRect(x, y, 9, 7);
    }
    const straight = await analyzeBookPage(canvas.toDataURL("image/png"));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111";
    for (const y of [185, 285, 385, 485, 585, 685]) {
      for (let x = 60; x < canvas.width - 60; x += 15) {
        const tiltedY = Math.round(y + 28 * (x / (canvas.width - 1) - 0.5));
        context.fillRect(x, tiltedY, 9, 7);
      }
    }
    const tilted = await analyzeBookPage(canvas.toDataURL("image/png"));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blank = await analyzeBookPage(canvas.toDataURL("image/png"));
    return {
      straight: straight.curve,
      tilted: tilted.curve,
      blank: blank.curve,
      blankRegions: blank.regions,
    };
  }, modulePath);

  expect(result.straight).toBeNull();
  expect(result.tilted).toBeNull();
  expect(result.blank).toBeNull();
  expect(result.blankRegions).toEqual([]);
});

test("suggests only edge-connected warm regions and excludes a central warm mark", async ({
  page,
}) => {
  const regions = await page.evaluate(async (path) => {
    const { analyzeBookPage } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f6f1e8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#b87b61";
    context.fillRect(0, 180, 130, 340);
    context.fillRect(670, 250, 130, 280);
    context.fillRect(335, 350, 130, 115);
    const result = await analyzeBookPage(canvas.toDataURL("image/png"));
    return result.regions;
  }, modulePath);

  expect(regions.length).toBeGreaterThanOrEqual(2);
  expect(regions.length).toBeLessThanOrEqual(6);
  for (const region of regions) {
    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.y).toBeGreaterThanOrEqual(0);
    expect(region.x + region.width).toBeLessThanOrEqual(1);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
    expect(region.width * region.height).toBeLessThanOrEqual(0.15);
    expect(region.x < 0.25 || region.x >= 0.75).toBe(true);
  }
  const logo = {
    x: 335 / 800,
    y: 350 / 900,
    width: 130 / 800,
    height: 115 / 900,
  };
  const overlapsLogo = regions.some(
    (region: { x: number; y: number; width: number; height: number }) =>
      region.x < logo.x + logo.width &&
      region.x + region.width > logo.x &&
      region.y < logo.y + logo.height &&
      region.y + region.height > logo.y,
  );
  expect(overlapsLogo).toBe(false);
});
