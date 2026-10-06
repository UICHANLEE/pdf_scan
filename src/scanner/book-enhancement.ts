export type CurveOptions = {
  amount: number;
  edge: "left" | "right" | "both";
};

export type MaskRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BookPageAnalysis = {
  curve: CurveOptions | null;
  regions: MaskRegion[];
  warnings: string[];
};

export type EnhanceBookPageOptions = {
  curve: CurveOptions | null;
  regions: MaskRegion[];
};

const MAX_DATA_URL_CHARS = 40 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 30_000_000;
const MAX_OUTPUT_EDGE = 2200;
const MAX_WORK_PIXELS = 30_000_000;
const MAX_REGIONS = 6;
const MAX_REGION_AREA = 0.15;
const MAX_TOTAL_REGION_AREA = 0.25;
const CURVE_MAX_HEIGHT = 0.06;

type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function fail(message: string): Error {
  return new Error(message);
}

function loadLocalImage(source: string): Promise<HTMLImageElement> {
  if (typeof source !== "string" || source.length > MAX_DATA_URL_CHARS) {
    return Promise.reject(
      fail(
        "이미지 데이터가 너무 큽니다. 40MB 이하의 로컬 이미지를 사용해 주세요.",
      ),
    );
  }
  if (!/^data:image\/(?:jpeg|png);base64,[a-z\d+/]*={0,2}$/i.test(source)) {
    return Promise.reject(
      fail("로컬 JPEG 또는 PNG 데이터 URL만 처리할 수 있습니다."),
    );
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(fail("이미지 크기를 확인할 수 없습니다."));
      } else if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
        reject(
          fail(
            "원본 이미지가 3,000만 픽셀을 넘습니다. 크기를 줄인 뒤 다시 시도해 주세요.",
          ),
        );
      } else {
        resolve(image);
      }
    };
    image.onerror = () =>
      reject(
        fail(
          "이미지를 읽지 못했습니다. 손상 여부와 파일 형식을 확인해 주세요.",
        ),
      );
    image.src = source;
  });
}

function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw fail("브라우저에서 페이지 이미지 처리를 시작할 수 없습니다.");
  return { canvas, context };
}

function decodeImageData(
  dataUrl: string,
  maxEdge = MAX_OUTPUT_EDGE,
): Promise<RgbaImage> {
  return loadLocalImage(dataUrl).then((image) => {
    const scale = Math.min(
      1,
      maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    if (width * height > MAX_WORK_PIXELS)
      throw fail("이미지 처리 크기가 안전 한도를 넘습니다.");
    const { context } = makeCanvas(width, height);
    // Flatten transparent PNG pixels against white before examining or transforming color.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data };
  });
}

function grayAt(data: Uint8ClampedArray, index: number): number {
  return (
    data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function profileAt(x: number, edge: CurveOptions["edge"]): number {
  const position = Math.max(0, Math.min(1, x));
  const left = Math.exp(-position / 0.22);
  const right = Math.exp(-(1 - position) / 0.22);
  if (edge === "left") return left;
  if (edge === "right") return right;
  return Math.max(left, right);
}

type CurveFit = {
  edge: CurveOptions["edge"];
  amount: number;
  residual: number;
  signal: number;
};

/** Estimate bowed text rows from horizontal darkness projections in eight vertical bands.
 * This deliberately returns no suggestion unless several separate text rows agree on one
 * smooth edge-weighted bend. It does not attempt OCR, page-layout understanding, or learned detection.
 */
function estimateCurve(image: RgbaImage): CurveOptions | null {
  const { width, height, data } = image;
  if (width < 160 || height < 180) return null;
  const bandCount = 8;
  const top = Math.floor(height * 0.1);
  const bottom = Math.ceil(height * 0.9);
  const bandProjection = Array.from(
    { length: bandCount },
    () => new Float32Array(height),
  );

  for (let band = 0; band < bandCount; band++) {
    const x0 = Math.floor(width * (0.08 + (0.84 * band) / bandCount));
    const x1 = Math.floor(width * (0.08 + (0.84 * (band + 1)) / bandCount));
    const bandWidth = Math.max(1, x1 - x0);
    const rows = bandProjection[band];
    for (let y = top; y < bottom; y++) {
      let dark = 0;
      for (let x = x0; x < x1; x++) {
        if (grayAt(data, (y * width + x) * 4) < 165) dark++;
      }
      rows[y] = dark / bandWidth;
    }
    const raw = rows.slice();
    for (let y = top + 2; y < bottom - 2; y++) {
      rows[y] =
        (raw[y - 2] +
          2 * raw[y - 1] +
          3 * raw[y] +
          2 * raw[y + 1] +
          raw[y + 2]) /
        9;
    }
  }

  const global = new Float32Array(height);
  for (let y = top; y < bottom; y++) {
    for (let band = 0; band < bandCount; band++)
      global[y] += bandProjection[band][y] / bandCount;
  }
  const candidates: number[] = [];
  for (let y = top + 3; y < bottom - 3; y++) {
    if (
      global[y] >= 0.018 &&
      global[y] >= global[y - 1] &&
      global[y] > global[y + 1]
    )
      candidates.push(y);
  }
  const minimumGap = Math.max(7, Math.floor(height * 0.018));
  candidates.sort((a, b) => global[b] - global[a]);
  const rows: number[] = [];
  for (const y of candidates) {
    if (rows.every((existing) => Math.abs(existing - y) >= minimumGap))
      rows.push(y);
  }
  rows.sort((a, b) => a - b);
  if (rows.length < 4) return null;

  const observations: Array<{ y: number; offsets: Array<number | null> }> = [];
  const coverage = new Array<number>(bandCount).fill(0);
  const search = Math.max(4, Math.floor(height * 0.045));
  for (const centerY of rows) {
    const local: Array<number | null> = [];
    for (let band = 0; band < bandCount; band++) {
      const projection = bandProjection[band];
      let bestY = centerY;
      let bestDensity = 0;
      for (
        let y = Math.max(top + 2, centerY - search);
        y <= Math.min(bottom - 3, centerY + search);
        y++
      ) {
        if (projection[y] > bestDensity) {
          bestY = y;
          bestDensity = projection[y];
        }
      }
      local.push(bestDensity >= 0.035 ? bestY : null);
    }
    const usable = local.filter((value): value is number => value !== null);
    if (usable.length < 6) continue;
    const anchor = median(usable);
    const central = local
      .slice(3, 5)
      .filter((value): value is number => value !== null);
    if (central.length === 0) continue;
    const centerObservation = median(central);
    for (let band = 0; band < bandCount; band++) {
      if (local[band] !== null) coverage[band]++;
    }
    observations.push({
      y: anchor,
      offsets: local.map((value) =>
        value === null ? null : value - centerObservation,
      ),
    });
  }
  if (observations.length < 4 || coverage.some((count) => count < 3))
    return null;

  const xPositions = Array.from(
    { length: bandCount },
    (_, band) => 0.08 + (0.84 * (band + 0.5)) / bandCount,
  );
  // Compare curvature against ordinary tilt; tilted but straight text rows
  // must not be advertised as evidence of a bowed page.
  const centerX = median(xPositions.slice(3, 5));
  let tiltNumerator = 0,
    tiltDenominator = 0;
  for (const row of observations)
    for (let band = 0; band < bandCount; band++) {
      const offset = row.offsets[band];
      if (offset === null) continue;
      const basis = xPositions[band] - centerX;
      tiltNumerator += basis * offset;
      tiltDenominator += basis * basis;
    }
  const tilt = tiltNumerator / Math.max(1e-6, tiltDenominator);
  let tiltError = 0;
  for (const row of observations)
    for (let band = 0; band < bandCount; band++) {
      const offset = row.offsets[band];
      if (offset !== null)
        tiltError += (offset - tilt * (xPositions[band] - centerX)) ** 2;
    }
  const candidatesFit: CurveFit[] = [];
  for (const edge of ["left", "right", "both"] as const) {
    const profiles = xPositions.map((x) => profileAt(x, edge));
    const centerProfile = median(profiles.slice(3, 5));
    let numerator = 0;
    let denominator = 0;
    for (const row of observations) {
      const verticalFactor = Math.sin(
        (Math.PI * row.y) / Math.max(1, height - 1),
      );
      if (verticalFactor < 0.25) continue;
      for (let band = 0; band < bandCount; band++) {
        const observed = row.offsets[band];
        if (observed === null) continue;
        const xTerm = profiles[band] - centerProfile;
        const basis = xTerm * verticalFactor;
        numerator += basis * observed;
        denominator += basis * basis;
      }
    }
    if (denominator < 1e-6) continue;
    const displacementPixels = numerator / denominator;
    const amount = displacementPixels / (CURVE_MAX_HEIGHT * height);
    if (
      !Number.isFinite(amount) ||
      Math.abs(amount) < 0.12 ||
      Math.abs(amount) > 0.9
    )
      continue;

    let squaredError = 0;
    let squaredSignal = 0;
    let samples = 0;
    for (const row of observations)
      for (let band = 0; band < bandCount; band++) {
        const observed = row.offsets[band];
        if (observed === null) continue;
        const prediction =
          displacementPixels *
          (profiles[band] - centerProfile) *
          Math.sin((Math.PI * row.y) / Math.max(1, height - 1));
        const residual = observed - prediction;
        squaredError += residual * residual;
        squaredSignal += observed * observed;
        samples++;
      }
    const residual = Math.sqrt(squaredError / Math.max(1, samples));
    const signal = Math.sqrt(squaredSignal / Math.max(1, samples));
    // Text-row offsets must be both visible at this sampling size and explained by the fit.
    if (signal < 2.2 || residual > signal * 0.58) continue;
    if (tiltError <= squaredError * 1.25) continue;
    candidatesFit.push({ edge, amount, residual, signal });
  }
  if (!candidatesFit.length) return null;
  candidatesFit.sort((a, b) => a.residual / a.signal - b.residual / b.signal);
  const best = candidatesFit[0];
  if (candidatesFit.length > 1) {
    const next = candidatesFit[1];
    if (best.residual / best.signal > (next.residual / next.signal) * 0.82)
      return null;
  }
  return { edge: best.edge, amount: best.amount };
}

function isSkinCandidate(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Broad RGB chroma gates; deliberately a color heuristic, not a learned skin classifier.
  return (
    r > 90 &&
    g > 35 &&
    b > 18 &&
    max - min > 18 &&
    r > g &&
    r > b &&
    r - g > 10 &&
    r < 250
  );
}

/** Find edge-connected warm skin-colored components only in the outer quarter columns. */
function findSkinRegions(image: RgbaImage): MaskRegion[] {
  const { width, height, data } = image;
  const stripWidth = Math.max(1, Math.floor(width * 0.25));
  const visited = new Uint8Array(width * height);
  const candidates: Array<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    count: number;
    side: "left" | "right";
  }> = [];
  const maxPixelsPerComponent = Math.floor(width * height * 0.15);

  for (const side of ["left", "right"] as const) {
    const startX = side === "left" ? 0 : width - stripWidth;
    const endX = side === "left" ? stripWidth : width;
    for (let y = 0; y < height; y++) {
      for (let x = startX; x < endX; x++) {
        const index = y * width + x;
        if (visited[index]) continue;
        visited[index] = 1;
        const pixel = index * 4;
        if (!isSkinCandidate(data[pixel], data[pixel + 1], data[pixel + 2]))
          continue;

        const queue = [index];
        let cursor = 0;
        let x0 = x;
        let x1 = x;
        let y0 = y;
        let y1 = y;
        let count = 0;
        let connectedToImageEdge = false;
        while (cursor < queue.length && count <= maxPixelsPerComponent) {
          const current = queue[cursor++];
          const cx = current % width;
          const cy = Math.floor(current / width);
          count++;
          x0 = Math.min(x0, cx);
          x1 = Math.max(x1, cx);
          y0 = Math.min(y0, cy);
          y1 = Math.max(y1, cy);
          if (
            (side === "left" && cx === 0) ||
            (side === "right" && cx === width - 1) ||
            cy === 0 ||
            cy === height - 1
          )
            connectedToImageEdge = true;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < startX || nx >= endX || ny < 0 || ny >= height) continue;
              const neighbor = ny * width + nx;
              if (visited[neighbor]) continue;
              visited[neighbor] = 1;
              const offset = neighbor * 4;
              if (
                isSkinCandidate(
                  data[offset],
                  data[offset + 1],
                  data[offset + 2],
                )
              )
                queue.push(neighbor);
            }
          }
        }
        const boxArea = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (width * height);
        if (
          connectedToImageEdge &&
          count >= Math.max(12, width * height * 0.00006) &&
          boxArea <= MAX_REGION_AREA
        ) {
          candidates.push({ x0, y0, x1, y1, count, side });
        }
      }
    }
  }

  candidates.sort((a, b) => b.count - a.count);
  const regions: MaskRegion[] = [];
  const padX = Math.max(2, Math.round(width * 0.012));
  const padY = Math.max(2, Math.round(height * 0.012));
  let aggregate = 0;
  for (const candidate of candidates) {
    if (regions.length >= MAX_REGIONS) break;
    const minX = candidate.side === "left" ? 0 : width - stripWidth;
    const maxX = candidate.side === "left" ? stripWidth - 1 : width - 1;
    const x0 = Math.max(minX, candidate.x0 - padX);
    const x1 = Math.min(maxX, candidate.x1 + padX);
    const y0 = Math.max(0, candidate.y0 - padY);
    const y1 = Math.min(height - 1, candidate.y1 + padY);
    const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (width * height);
    if (area > MAX_REGION_AREA || aggregate + area > MAX_TOTAL_REGION_AREA)
      continue;
    aggregate += area;
    regions.push({
      id: `skin-${regions.length + 1}`,
      x: x0 / width,
      y: y0 / height,
      width: (x1 - x0 + 1) / width,
      height: (y1 - y0 + 1) / height,
    });
  }
  return regions;
}

export async function analyzeBookPage(
  source: string,
): Promise<BookPageAnalysis> {
  // Analysis needs only a small raster. Keep connected-component queues and
  // projection scans independent of camera resolution; normalized suggestions
  // still refer to the full image. The actual edit uses the full 2200px raster.
  const image = await decodeImageData(source, 800);
  const curve = estimateCurve(image);
  const regions = findSkinRegions(image);
  const warnings: string[] = [];
  if (!curve)
    warnings.push(
      "글자 줄의 휨 근거가 충분하지 않아 곡률 보정 제안을 만들지 않았습니다.",
    );
  if (regions.length)
    warnings.push(
      "가장자리의 피부색 유사 영역 후보입니다. 색상 규칙 기반 제안이므로 확인한 영역만 적용하세요.",
    );
  else
    warnings.push(
      "가장자리에서 피부색 유사 후보를 찾지 못했습니다. 조명과 종이 색에 따라 놓치거나 잘못 찾을 수 있습니다.",
    );
  if (regions.length)
    warnings.push(
      "영역 정리는 선택한 부분을 주변 종이색으로 덮습니다. 손가락 뒤의 글자나 질감은 복원하지 않습니다.",
    );
  return { curve, regions, warnings };
}

function validateCurve(curve: CurveOptions | null): CurveOptions | null {
  if (curve === null) return null;
  if (
    !curve ||
    typeof curve !== "object" ||
    !Number.isFinite(curve.amount) ||
    curve.amount < -1 ||
    curve.amount > 1
  ) {
    throw fail("곡률 보정 값은 -1에서 1 사이의 유한한 숫자여야 합니다.");
  }
  if (
    curve.edge !== "left" &&
    curve.edge !== "right" &&
    curve.edge !== "both"
  ) {
    throw fail("곡률 기준 가장자리가 올바르지 않습니다.");
  }
  return curve;
}

function validateRegions(regions: MaskRegion[]): MaskRegion[] {
  if (!Array.isArray(regions) || regions.length > MAX_REGIONS)
    throw fail("정리 영역은 최대 6개까지 지정할 수 있습니다.");
  let totalArea = 0;
  const ids = new Set<string>();
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (
      !region ||
      typeof region.id !== "string" ||
      !region.id.trim() ||
      ids.has(region.id)
    )
      throw fail("정리 영역 ID가 비어 있거나 중복되었습니다.");
    ids.add(region.id);
    const { x, y, width, height } = region;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1 ||
      y + height > 1
    ) {
      throw fail("정리 영역은 이미지 안의 유효한 정규화 좌표여야 합니다.");
    }
    const area = width * height;
    if (area > MAX_REGION_AREA)
      throw fail("각 정리 영역은 이미지 면적의 15% 이하여야 합니다.");
    totalArea += area;
    for (let j = 0; j < i; j++) {
      const other = regions[j];
      const overlaps =
        x < other.x + other.width &&
        x + width > other.x &&
        y < other.y + other.height &&
        y + height > other.y;
      if (overlaps) throw fail("겹치는 정리 영역은 함께 적용할 수 없습니다.");
    }
  }
  if (totalArea > MAX_TOTAL_REGION_AREA)
    throw fail("정리 영역의 합은 이미지 면적의 25% 이하여야 합니다.");
  return regions;
}

function palePaperColor(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  const { width, height, data } = image;
  const radius = Math.min(
    24,
    Math.max(3, Math.round(Math.min(width, height) * 0.012)),
  );
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const sx0 = Math.max(0, x0 - radius);
  const sx1 = Math.min(width - 1, x1 + radius);
  const sy0 = Math.max(0, y0 - radius);
  const sy1 = Math.min(height - 1, y1 + radius);
  for (let y = sy0; y <= sy1; y += 2) {
    for (let x = sx0; x <= sx1; x += 2) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      if (x >= x0 && x <= x1 && y > y0 - 2 && y < y1 + 2) continue;
      if (y >= y0 && y <= y1 && x > x0 - 2 && x < x1 + 2) continue;
      const offset = (y * width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (grayAt(data, offset) < 185 || isSkinCandidate(red, green, blue))
        continue;
      r.push(red);
      g.push(green);
      b.push(blue);
    }
  }
  if (r.length < 8)
    throw fail(
      "정리 영역 주변에서 종이색 표본을 충분히 찾지 못했습니다. 해당 영역은 적용할 수 없습니다.",
    );
  return [median(r), median(g), median(b)];
}

function cleanApprovedRegions(image: RgbaImage, regions: MaskRegion[]): void {
  const { width, height, data } = image;
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x * width));
    const y0 = Math.max(0, Math.floor(region.y * height));
    const x1 = Math.min(
      width - 1,
      Math.ceil((region.x + region.width) * width) - 1,
    );
    const y1 = Math.min(
      height - 1,
      Math.ceil((region.y + region.height) * height) - 1,
    );
    const color = palePaperColor(image, x0, y0, x1, y1);
    const feather = Math.max(2, Math.min(x1 - x0 + 1, y1 - y0 + 1) * 0.12);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Feather only inward: pixels outside a user-approved rectangle are never changed.
        const distance = Math.min(
          x - x0 + 1,
          x1 - x + 1,
          y - y0 + 1,
          y1 - y + 1,
        );
        const t = Math.max(0, Math.min(1, distance / feather));
        const alpha = t * t * (3 - 2 * t);
        const offset = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          data[offset + channel] =
            data[offset + channel] * (1 - alpha) + color[channel] * alpha;
        }
      }
    }
  }
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const boundedY = Math.max(0, Math.min(height - 1, y));
  const y0 = Math.floor(boundedY);
  const y1 = Math.min(height - 1, y0 + 1);
  const fraction = boundedY - y0;
  const first = data[(y0 * width + x) * 4 + channel];
  const second = data[(y1 * width + x) * 4 + channel];
  return first * (1 - fraction) + second * fraction;
}

function applyCurve(image: RgbaImage, curve: CurveOptions | null): RgbaImage {
  if (!curve || curve.amount === 0) return image;
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data.length);
  for (let x = 0; x < width; x++) {
    const horizontalProfile = profileAt(x / Math.max(1, width - 1), curve.edge);
    for (let y = 0; y < height; y++) {
      const vertical = y / Math.max(1, height - 1);
      // Inverse map: positive amount samples lower source pixels near the chosen edge.
      // For height >= 2 its derivative is >= 1 - 0.06*pi*height/(height-1)
      // >= 1 - 0.12*pi > 0.62, so it cannot fold. A one-row image is unchanged.
      const sourceY =
        y +
        curve.amount *
          CURVE_MAX_HEIGHT *
          height *
          horizontalProfile *
          Math.sin(Math.PI * vertical);
      const out = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        output[out + channel] = sampleBilinear(
          data,
          width,
          height,
          x,
          sourceY,
          channel,
        );
      output[out + 3] = 255;
    }
  }
  return { width, height, data: output };
}

export async function enhanceBookPage(
  source: string,
  options: EnhanceBookPageOptions,
): Promise<string> {
  const curve = validateCurve(options?.curve ?? null);
  const regions = validateRegions(options?.regions ?? []);
  const image = await decodeImageData(source);
  cleanApprovedRegions(image, regions);
  const transformed = applyCurve(image, curve);
  const { canvas, context } = makeCanvas(transformed.width, transformed.height);
  const output = context.createImageData(transformed.width, transformed.height);
  output.data.set(transformed.data);
  context.putImageData(output, 0, 0);
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (error) {
    throw fail(
      `JPEG 이미지를 만들지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
