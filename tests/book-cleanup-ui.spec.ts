import { expect, test, type Page } from "@playwright/test";

async function makeBookFixture(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f3ead8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e8d6b8";
    context.fillRect(600, 0, 600, canvas.height);
    context.fillStyle = "#172033";
    context.font = "bold 72px Arial, sans-serif";
    context.textBaseline = "middle";
    context.fillText("Quiet Book 2026", 42, 190);
    context.font = "bold 38px Arial, sans-serif";
    for (let y = 290; y < 790; y += 95) {
      context.fillRect(42, y, 490 - (y % 140), 7);
      context.fillRect(42, y + 22, 440 - (y % 110), 5);
    }
    context.fillStyle = "#bf4939";
    context.fillRect(440, 50, 72, 54);
    return canvas.toDataURL("image/png");
  });
  return {
    name: "synthetic-book.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  };
}

async function importBook(page: Page) {
  await page.getByRole("button", { name: "책", exact: true }).click();
  await page
    .getByTestId("image-import")
    .setInputFiles(await makeBookFixture(page));
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();
  await expect(page.locator(".page-thumb")).toHaveCount(2);
}

async function openBookCleanup(page: Page) {
  await page.getByRole("button", { name: "책 보정", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "로컬 책 보정" }),
  ).toBeVisible();
}

async function setRange(page: Page, label: string, value: number) {
  await page
    .getByRole("slider", { name: label })
    .evaluate((element, nextValue) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, String(nextValue));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}

async function preview(page: Page) {
  await page
    .getByRole("button", { name: "보정 미리보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "이 결과 적용", exact: true }),
  ).toBeEnabled();
}

async function pageSnapshot(page: Page) {
  return page
    .locator(".actual-preview img")
    .evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Snapshot canvas is unavailable");
      context.drawImage(element, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const sample = (x: number, y: number) => {
        const offset = (y * canvas.width + x) * 4;
        return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      };
      return {
        width: canvas.width,
        height: canvas.height,
        samples: [
          sample(24, 180),
          sample(200, 185),
          sample(40, 430),
          sample(430, 650),
        ],
      };
    });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("preview and cancel preserve the page, apply changes pixels, and undo restores the baseline", async ({
  page,
}) => {
  await importBook(page);
  await page.getByRole("button", { name: "원본", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "원본", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const baseline = await pageSnapshot(page);

  await openBookCleanup(page);
  await setRange(page, "휘어짐 강도", 60);
  await preview(page);
  await expect(
    page.getByRole("img", { name: "책 보정 미리보기" }),
  ).toBeVisible();
  expect(await pageSnapshot(page)).toEqual(baseline);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "로컬 책 보정" })).toHaveCount(
    0,
  );
  expect(await pageSnapshot(page)).toEqual(baseline);

  await openBookCleanup(page);
  await setRange(page, "휘어짐 강도", 60);
  await preview(page);
  await page.getByRole("button", { name: "이 결과 적용", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "책 보정 되돌리기", exact: true }),
  ).toBeVisible();
  const applied = await pageSnapshot(page);
  expect(applied.width).toBe(baseline.width);
  expect(applied.height).toBe(baseline.height);
  expect(applied.samples).not.toEqual(baseline.samples);

  await page
    .getByRole("button", { name: "책 보정 되돌리기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "책 보정 되돌리기", exact: true }),
  ).toHaveCount(0);
  const restored = await pageSnapshot(page);
  expect(restored.width).toBe(baseline.width);
  expect(restored.height).toBe(baseline.height);
  for (let sample = 0; sample < baseline.samples.length; sample++) {
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(
          restored.samples[sample][channel] - baseline.samples[sample][channel],
        ),
      ).toBeLessThanOrEqual(2);
    }
  }
});

test("edited range invalidates a preview and only allows a fresh preview to be applied", async ({
  page,
}) => {
  await importBook(page);
  await openBookCleanup(page);
  await setRange(page, "휘어짐 강도", 25);
  await preview(page);
  await expect(
    page.getByRole("button", { name: "이 결과 적용", exact: true }),
  ).toBeEnabled();
  await setRange(page, "휘어짐 강도", 45);
  await expect(
    page.getByRole("button", { name: "이 결과 적용", exact: true }),
  ).toBeDisabled();
  await preview(page);
  await expect(
    page.getByRole("button", { name: "이 결과 적용", exact: true }),
  ).toBeEnabled();
});

test("an oversized manually approved mask is rejected in the dialog", async ({
  page,
}) => {
  await importBook(page);
  await openBookCleanup(page);
  await page
    .getByRole("button", { name: "가릴 영역 추가", exact: true })
    .click();
  await setRange(page, "영역 너비", 90);
  await page
    .getByRole("button", { name: "보정 미리보기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "각 정리 영역은 이미지 면적의 15% 이하여야 합니다.",
  );
  await expect(
    page.getByRole("button", { name: "이 결과 적용", exact: true }),
  ).toBeDisabled();
});

test("cleanup clears OCR, and its undo source survives save, reload, and library load", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const title = "보정된 책 문서";
  await importBook(page);
  const reloadMessages: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", (event) => {
      const payload = String(event.payload);
      if (payload.includes("full-reload")) reloadMessages.push(payload);
    }),
  );
  page.on("console", (message) => {
    if (message.text().includes("[vite]")) reloadMessages.push(message.text());
  });
  await page.getByRole("button", { name: "텍스트 추출", exact: true }).click();
  await Promise.race([
    page
      .getByRole("heading", { name: "추출된 텍스트" })
      .waitFor({ state: "visible", timeout: 90_000 }),
    page
      .getByRole("heading", { name: "문서를 스캔하세요" })
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(() => {
        throw new Error(
          `OCR initialization lost the scan session: ${reloadMessages.join(" | ")}`,
        );
      }),
  ]);
  await expect(page.getByText(/Quiet/i)).toBeVisible();
  await page.keyboard.press("Escape");

  await openBookCleanup(page);
  await setRange(page, "휘어짐 강도", 40);
  await preview(page);
  await page.getByRole("button", { name: "이 결과 적용", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "책 보정 되돌리기", exact: true }),
  ).toBeVisible();
  const applied = await pageSnapshot(page);
  await page.getByRole("button", { name: "문서 저장", exact: true }).click();
  await page.getByRole("textbox", { name: "문서 제목" }).fill(title);
  await page.getByRole("button", { name: "기기에 저장", exact: true }).click();
  await expect(
    page.getByText("이 브라우저에 문서를 저장했어요."),
  ).toBeVisible();
  await page.reload();

  await page.getByRole("button", { name: "내 문서", exact: true }).click();
  const search = page.getByRole("textbox", { name: "문서 검색" });
  const saved = page.getByRole("button").filter({ hasText: title });
  await search.fill("Quiet");
  await expect(saved).toHaveCount(0);
  await search.fill(title);
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(
    page.getByRole("button", { name: "책 보정 되돌리기", exact: true }),
  ).toBeVisible();
  expect(await pageSnapshot(page)).toEqual(applied);
  await page
    .getByRole("button", { name: "책 보정 되돌리기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "책 보정 되돌리기", exact: true }),
  ).toHaveCount(0);
});

test("cleanup dialog fits the device viewport on iPhone and Pixel and only exposes range inputs", async ({
  page,
}) => {
  await importBook(page);
  const checkDialog = async () => {
    await openBookCleanup(page);
    const viewport = await page
      .getByTestId("mobile-app-viewport")
      .boundingBox();
    expect(viewport).not.toBeNull();
    await expect
      .poll(() =>
        page.getByTestId("bottom-sheet").evaluate(
          (element, bounds) => {
            const dialog = element.getBoundingClientRect();
            return (
              dialog.top >= bounds.top && dialog.bottom <= bounds.bottom + 1
            );
          },
          { top: viewport!.y, bottom: viewport!.y + viewport!.height },
        ),
      )
      .toBe(true);
    await expect(
      page.getByTestId("bottom-sheet").locator('input:not([type="range"])'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("bottom-sheet").locator('input[type="range"]'),
    ).not.toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "로컬 책 보정" }),
    ).toHaveCount(0);
  };

  await checkDialog();
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await expect(page.getByTestId("device-screen")).toHaveAttribute(
    "data-device",
    "pixel-10",
  );
  await checkDialog();
});
