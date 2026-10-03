export type OcrLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
export type OcrResult = { text: string; confidence: number; lines: OcrLine[] };
type OcrMessage =
  | { type: "progress"; progress: number }
  | { type: "result"; result: OcrResult }
  | { type: "error"; message: string };
const OCR_TIMEOUT_MS = 90_000;
let queue: Promise<void> = Promise.resolve();

function runRecognition(
  source: string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ocr-worker.ts", import.meta.url), {
      type: "module",
    });
    let settled = false;
    const finish = (result?: OcrResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (result) resolve(result);
      else reject(error ?? new Error("OCR 작업에 실패했습니다."));
    };
    const timer = window.setTimeout(
      () =>
        finish(
          undefined,
          new Error(
            "OCR 처리 시간이 90초를 넘었습니다. 이미지를 줄인 뒤 다시 시도해 주세요.",
          ),
        ),
      OCR_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<OcrMessage>) => {
      const message = event.data;
      if (message.type === "result") finish(message.result);
      else if (message.type === "error")
        finish(undefined, new Error(message.message));
      else if (message.type === "progress" && Number.isFinite(message.progress))
        onProgress?.(Math.max(0, Math.min(1, message.progress)));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        undefined,
        new Error(event.message || "OCR worker를 실행하지 못했습니다."),
      );
    };
    worker.onmessageerror = () =>
      finish(undefined, new Error("OCR worker 응답을 읽을 수 없습니다."));
    try {
      worker.postMessage({ source });
    } catch (error) {
      finish(
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  });
}

export function recognizeText(
  source: string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  if (
    !/^data:image\/(?:jpeg|png);base64,/.test(source) ||
    source.length > 40 * 1024 * 1024
  )
    return Promise.reject(
      new Error("OCR에는 30MB 이하의 로컬 이미지가 필요합니다."),
    );
  const result = queue.then(() => runRecognition(source, onProgress));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("90초")) throw error;
    throw new Error(
      `문자 인식에 실패했습니다. 이미지와 OCR 파일을 확인해 주세요. (${message})`,
    );
  });
}
