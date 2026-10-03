import { expect, test } from "@playwright/test";

test("recognizes real Korean print using the bundled language model", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const recognized = await page.evaluate(async () => {
    const font = new FontFace("ScanTestKorean", "url(/fonts/NotoSansKR.ttf)");
    await font.load();
    document.fonts.add(font);
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 700;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 1400, 700);
    context.fillStyle = "black";
    context.font = '90px "ScanTestKorean"';
    context.fillText("한글 문서 스캔 테스트", 70, 340);
    const module = await import(
      new URL("/src/scanner/ocr.ts", location.href).href
    );
    return module.recognizeText(canvas.toDataURL("image/jpeg", 0.95));
  });
  expect(recognized.text).toContain("한글");
  expect(recognized.text).toContain("문서");
  expect(recognized.confidence).toBeGreaterThan(0);
  expect(recognized.confidence).toBeLessThanOrEqual(1);
});

test("OCR startup timeout terminates the job and allows another attempt", async ({
  page,
}) => {
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async () => {
    const state = { attempts: 0, terminations: 0, errors: [] as string[] };
    (window as Window & { ocrTest?: typeof state }).ocrTest = state;
    // Simulate a parent worker that never finishes startup; real recognition
    // and real model loading are covered by the Korean and scanner tests.
    Object.defineProperty(window, "Worker", {
      value: class {
        onmessage = null;
        onerror = null;
        onmessageerror = null;
        constructor() {
          state.attempts++;
        }
        postMessage() {}
        terminate() {
          state.terminations++;
        }
      },
    });
    const module = await import(
      new URL("/src/scanner/ocr.ts", location.href).href
    );
    const attempt = () =>
      module
        .recognizeText("data:image/jpeg;base64,AAAA")
        .catch((error: Error) => state.errors.push(error.message));
    void attempt().then(attempt);
  });
  await page.clock.runFor(90_001);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { ocrTest?: { attempts: number } }).ocrTest
            ?.attempts,
      ),
    )
    .toBe(2);
  await page.clock.runFor(90_001);
  const state = await page.evaluate(
    () =>
      (
        window as Window & {
          ocrTest?: { terminations: number; errors: string[] };
        }
      ).ocrTest,
  );
  expect(state?.terminations).toBe(2);
  expect(state?.errors).toHaveLength(2);
  expect(state?.errors[0]).toContain("90초");
});
