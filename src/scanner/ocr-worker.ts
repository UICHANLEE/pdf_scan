import { createWorker } from "tesseract.js";
import type { OcrResult } from "./ocr";

// A disposable parent worker owns Tesseract's child worker. Terminating this
// parent also stops a child stuck during model initialization, not just recognition.
self.onmessage = async (event: MessageEvent<{ source: string }>) => {
  let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const asset = (path: string) => new URL(path, self.location.href).href;
    engine = await createWorker("kor+eng", 1, {
      workerPath: asset("/ocr/worker.min.js"),
      corePath: asset("/ocr/core"),
      langPath: asset("/ocr/lang"),
      workerBlobURL: false,
      gzip: true,
      errorHandler: (error) =>
        self.postMessage({ type: "error", message: String(error) }),
      logger: (message) => {
        if (message.status === "recognizing text")
          self.postMessage({ type: "progress", progress: message.progress });
      },
    });
    const { data } = await engine.recognize(
      event.data.source,
      {},
      { blocks: true },
    );
    const confidence = (value: number) =>
      Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0;
    const result: OcrResult = {
      text: data.text ?? "",
      confidence: confidence(data.confidence),
      lines: [],
    };
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs ?? [])
        for (const line of paragraph.lines ?? []) {
          const text = line.text?.trim();
          if (text)
            result.lines.push({
              text,
              confidence: confidence(line.confidence),
              bbox: line.bbox,
            });
        }
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await engine?.terminate();
  }
};
