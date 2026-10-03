export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type ImageFilter =
  "original" | "auto" | "document" | "bw" | "gray" | "photo";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 30_000_000;
const MAX_OUTPUT_EDGE = 2200;
const MAX_OUTPUT_PIXELS = 15_000_000;

function imageError(message: string, cause?: unknown): Error {
  const error = new Error(message);
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

export function loadImage(source: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl =
      typeof source === "string" ? undefined : URL.createObjectURL(source);
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    image.onload = () => {
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(imageError("이미지 크기를 확인할 수 없습니다."));
        return;
      }
      resolve(image);
    };
    image.onerror = (event) => {
      cleanup();
      reject(
        imageError(
          "이미지를 열 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.",
          event,
        ),
      );
    };
    image.src = objectUrl ?? (source as string);
  });
}

function canvas2d(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw imageError("브라우저에서 이미지 처리를 시작할 수 없습니다.");
  return { canvas, context };
}

function jpegDataUrl(canvas: HTMLCanvasElement, quality = 0.9): string {
  try {
    return canvas.toDataURL("image/jpeg", quality);
  } catch (error) {
    throw imageError("이미지를 JPEG로 저장하지 못했습니다.", error);
  }
}

export async function importImage(file: File): Promise<string> {
  const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!accepted.has(file.type)) {
    throw imageError("JPG, PNG, WEBP 이미지 파일만 가져올 수 있습니다.");
  }
  if (file.size > MAX_FILE_BYTES)
    throw imageError("이미지는 15MB 이하만 가져올 수 있습니다.");
  if (file.size === 0) throw imageError("비어 있는 이미지 파일입니다.");

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch (error) {
    throw imageError(
      "이미지 파일을 읽지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요.",
      error,
    );
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width * height > MAX_SOURCE_PIXELS) {
    throw imageError(
      "이미지 해상도가 너무 큽니다. 3,000만 픽셀 이하의 파일을 사용해 주세요.",
    );
  }

  const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const { canvas, context } = canvas2d(outWidth, outHeight);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, outWidth, outHeight);
  context.drawImage(image, 0, 0, outWidth, outHeight);
  return jpegDataUrl(canvas, 0.92);
}

function luminance(data: Uint8ClampedArray, offset: number): number {
  return (
    data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
  );
}

function sortQuad(points: Point[]): Quad {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const others = bySum.slice(1, 3);
  const tr =
    others[0].x - others[0].y > others[1].x - others[1].y
      ? others[0]
      : others[1];
  const bl = tr === others[0] ? others[1] : others[0];
  return [tl, tr, br, bl];
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function isConvexQuad(points: Quad): boolean {
  let direction = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || Math.abs(cross) < 1e-6) return false;
    const sign = Math.sign(cross);
    if (direction && sign !== direction) return false;
    direction = sign;
  }
  return true;
}

export async function detectDocument(source: string): Promise<Quad | null> {
  const image = await loadImage(source);
  const scale = Math.min(
    1,
    480 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(3, Math.round(image.naturalWidth * scale));
  const height = Math.max(3, Math.round(image.naturalHeight * scale));
  const { canvas, context } = canvas2d(width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = luminance(pixels, i * 4);

  const edges = new Float32Array(width * height);
  const magnitudes: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] +
        gray[i - width + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + width - 1] +
        gray[i + width + 1];
      const gy =
        -gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1] +
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1];
      const strength = Math.hypot(gx, gy) / 4;
      edges[i] = strength;
      if (strength > 0) magnitudes.push(strength);
    }
  }
  if (magnitudes.length < width * height * 0.005) return null;
  magnitudes.sort((a, b) => a - b);
  const threshold = Math.max(
    28,
    magnitudes[Math.floor(magnitudes.length * 0.68)],
  );

  const extremes: [Point, number][] = [
    [{ x: 0, y: 0 }, Infinity], // top-left: minimum x+y
    [{ x: 0, y: 0 }, -Infinity], // top-right: maximum x-y
    [{ x: 0, y: 0 }, -Infinity], // bottom-right: maximum x+y
    [{ x: 0, y: 0 }, Infinity], // bottom-left: minimum x-y
  ];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (edges[y * width + x] < threshold) continue;
      const values = [x + y, x - y, x + y, x - y];
      const improves = [
        values[0] < extremes[0][1],
        values[1] > extremes[1][1],
        values[2] > extremes[2][1],
        values[3] < extremes[3][1],
      ];
      for (let index = 0; index < 4; index++) {
        if (improves[index]) extremes[index] = [{ x, y }, values[index]];
      }
    }
  }
  const points = extremes.map(([point]) => point);
  const quad = sortQuad(points);
  const area = polygonArea(quad);
  if (area < width * height * 0.08 || area > width * height * 0.97) return null;

  // Reject collapsed or self-crossing candidates and require visible edge support on each side.
  const sideLengths = quad.map((point, i) =>
    Math.hypot(quad[(i + 1) % 4].x - point.x, quad[(i + 1) % 4].y - point.y),
  );
  if (sideLengths.some((length) => length < Math.min(width, height) * 0.12))
    return null;
  let supported = 0;
  for (let side = 0; side < 4; side++) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    let hits = 0;
    const samples = 24;
    for (let sample = 0; sample < samples; sample++) {
      const t = (sample + 0.5) / samples;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      let strongest = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          strongest = Math.max(
            strongest,
            edges[(y + dy) * width + x + dx] ?? 0,
          );
        }
      if (strongest >= threshold * 0.65) hits++;
    }
    if (hits / samples >= 0.16) supported++;
  }
  if (supported < 2) return null;

  const factorX = image.naturalWidth / width;
  const factorY = image.naturalHeight / height;
  return quad.map((point) => ({
    x: Math.max(0, Math.min(image.naturalWidth - 1, point.x * factorX)),
    y: Math.max(0, Math.min(image.naturalHeight - 1, point.y * factorY)),
  })) as Quad;
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column]))
        pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10)
      throw imageError("문서 모서리를 펴는 데 필요한 계산을 할 수 없습니다.");
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    for (let j = column; j <= size; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= size; j++)
        augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[size]);
}

function transformPixels(data: Uint8ClampedArray, filter: ImageFilter): void {
  if (filter === "original") return;
  let min = 255;
  let max = 0;
  let sum = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const value = luminance(data, i);
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  const average = sum / count;
  const contrast = max - min;
  let threshold = 175;
  if (filter === "bw") {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4)
      histogram[Math.round(luminance(data, i))]++;
    let totalSum = 0;
    for (let i = 0; i < 256; i++) totalSum += i * histogram[i];
    let backgroundSum = 0;
    let backgroundWeight = 0;
    let bestVariance = -1;
    for (let i = 0; i < 256; i++) {
      backgroundWeight += histogram[i];
      if (!backgroundWeight) continue;
      const foregroundWeight = count - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += i * histogram[i];
      const delta =
        backgroundSum / backgroundWeight -
        (totalSum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * delta * delta;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = i;
      }
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = luminance(data, i);
    let next: number;
    if (filter === "gray") next = gray;
    else if (filter === "bw") next = gray > threshold ? 255 : 0;
    else if (filter === "photo") {
      const saturation = 1.12;
      data[i] = Math.max(0, Math.min(255, gray + (r - gray) * saturation + 2));
      data[i + 1] = Math.max(
        0,
        Math.min(255, gray + (g - gray) * saturation + 1),
      );
      data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * saturation));
      continue;
    } else {
      const targetContrast = filter === "document" ? 1.38 : 1.18;
      const pivot = filter === "document" ? Math.max(148, average) : 128;
      next =
        (gray - pivot) * targetContrast + (filter === "document" ? 222 : 132);
      if (filter === "auto" && contrast < 115)
        next =
          (gray - min) * (255 / Math.max(1, contrast)) * 0.72 + gray * 0.28;
    }
    const value = Math.max(0, Math.min(255, next));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
}

export async function processImage(
  source: string,
  quad?: Quad,
  filter: ImageFilter = "auto",
): Promise<string> {
  const image = await loadImage(source);
  const originalWidth = image.naturalWidth;
  const originalHeight = image.naturalHeight;
  if (originalWidth * originalHeight > MAX_SOURCE_PIXELS)
    throw imageError("처리할 이미지 해상도가 너무 큽니다.");
  const inputScale = Math.min(
    1,
    MAX_OUTPUT_EDGE / Math.max(originalWidth, originalHeight),
  );
  const inputWidth = Math.max(1, Math.round(originalWidth * inputScale));
  const inputHeight = Math.max(1, Math.round(originalHeight * inputScale));
  const corners: Quad = (
    quad ?? [
      { x: 0, y: 0 },
      { x: originalWidth - 1, y: 0 },
      { x: originalWidth - 1, y: originalHeight - 1 },
      { x: 0, y: originalHeight - 1 },
    ]
  ).map((point) => ({
    x: point.x * inputScale,
    y: point.y * inputScale,
  })) as Quad;
  for (const point of corners) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= inputWidth ||
      point.y >= inputHeight
    ) {
      throw imageError("문서 모서리가 이미지 범위를 벗어났습니다.");
    }
  }
  if (
    !isConvexQuad(corners) ||
    polygonArea(corners) < inputWidth * inputHeight * 0.005
  ) {
    throw imageError("문서 모서리는 겹치지 않는 볼록한 사각형이어야 합니다.");
  }
  if (!quad) {
    const { canvas, context } = canvas2d(inputWidth, inputHeight);
    context.drawImage(image, 0, 0, inputWidth, inputHeight);
    const pixels = context.getImageData(0, 0, inputWidth, inputHeight);
    transformPixels(pixels.data, filter);
    context.putImageData(pixels, 0, 0);
    return jpegDataUrl(canvas);
  }
  const [tl, tr, br, bl] = corners;
  const naturalWidth = Math.max(
    Math.hypot(tr.x - tl.x, tr.y - tl.y),
    Math.hypot(br.x - bl.x, br.y - bl.y),
  );
  const naturalHeight = Math.max(
    Math.hypot(bl.x - tl.x, bl.y - tl.y),
    Math.hypot(br.x - tr.x, br.y - tr.y),
  );
  const scale = Math.min(
    1,
    MAX_OUTPUT_EDGE / Math.max(naturalWidth, naturalHeight),
    Math.sqrt(MAX_OUTPUT_PIXELS / (naturalWidth * naturalHeight)),
  );
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const destination: Quad = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const equations: number[][] = [];
  const values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = destination[i];
    const sourcePoint = corners[i];
    equations.push([x, y, 1, 0, 0, 0, -sourcePoint.x * x, -sourcePoint.x * y]);
    values.push(sourcePoint.x);
    equations.push([0, 0, 0, x, y, 1, -sourcePoint.y * x, -sourcePoint.y * y]);
    values.push(sourcePoint.y);
  }
  const h = solveLinear(equations, values);
  const { canvas, context } = canvas2d(width, height);
  const output = context.createImageData(width, height);
  const sourceCanvas = canvas2d(inputWidth, inputHeight);
  sourceCanvas.context.drawImage(image, 0, 0, inputWidth, inputHeight);
  const input = sourceCanvas.context.getImageData(
    0,
    0,
    inputWidth,
    inputHeight,
  ).data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const denominator = h[6] * x + h[7] * y + 1;
      const sx = (h[0] * x + h[1] * y + h[2]) / denominator;
      const sy = (h[3] * x + h[4] * y + h[5]) / denominator;
      const x0 = Math.max(0, Math.min(inputWidth - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(inputHeight - 1, Math.floor(sy)));
      const x1 = Math.min(inputWidth - 1, x0 + 1);
      const y1 = Math.min(inputHeight - 1, y0 + 1);
      const dx = Math.max(0, Math.min(1, sx - x0));
      const dy = Math.max(0, Math.min(1, sy - y0));
      const outIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top =
          input[(y0 * inputWidth + x0) * 4 + channel] * (1 - dx) +
          input[(y0 * inputWidth + x1) * 4 + channel] * dx;
        const bottom =
          input[(y1 * inputWidth + x0) * 4 + channel] * (1 - dx) +
          input[(y1 * inputWidth + x1) * 4 + channel] * dx;
        output.data[outIndex + channel] = top * (1 - dy) + bottom * dy;
      }
      output.data[outIndex + 3] = 255;
    }
  }
  transformPixels(output.data, filter);
  context.putImageData(output, 0, 0);
  return jpegDataUrl(canvas);
}

export async function splitBook(source: string): Promise<[string, string]> {
  const image = await loadImage(source);
  if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS)
    throw imageError("나눌 이미지 해상도가 너무 큽니다.");
  const scale = Math.min(
    1,
    MAX_OUTPUT_EDGE / Math.max(image.naturalWidth / 2, image.naturalHeight),
    Math.sqrt(
      MAX_OUTPUT_PIXELS / ((image.naturalWidth * image.naturalHeight) / 2),
    ),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const halfWidth = Math.floor(width / 2);
  if (halfWidth < 1)
    throw imageError("두 페이지로 나누기에는 이미지가 너무 좁습니다.");
  const left = canvas2d(halfWidth, height);
  const right = canvas2d(width - halfWidth, height);
  left.context.drawImage(
    image,
    0,
    0,
    image.naturalWidth / 2,
    image.naturalHeight,
    0,
    0,
    halfWidth,
    height,
  );
  right.context.drawImage(
    image,
    image.naturalWidth / 2,
    0,
    image.naturalWidth / 2,
    image.naturalHeight,
    0,
    0,
    width - halfWidth,
    height,
  );
  return [jpegDataUrl(left.canvas), jpegDataUrl(right.canvas)];
}

export async function rotateImage(source: string): Promise<string> {
  const image = await loadImage(source);
  const scale = Math.min(
    1,
    MAX_OUTPUT_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    Math.sqrt(MAX_OUTPUT_PIXELS / (image.naturalWidth * image.naturalHeight)),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const { canvas, context } = canvas2d(height, width);
  context.translate(height, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(image, 0, 0, width, height);
  return jpegDataUrl(canvas);
}
