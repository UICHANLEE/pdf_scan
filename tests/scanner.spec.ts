import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("book captures append pages only after processing and page selection works", async ({
  page,
}) => {
  await page.getByRole("button", { name: "촬영", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();
  await expect(page.getByText("2페이지", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "2페이지", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2페이지", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "추가 촬영" }).click();
  await page.getByRole("button", { name: "촬영", exact: true }).click();
  await expect(page.getByText("4페이지", { exact: true })).toBeVisible();
});

test("document mode adds one page and export cannot claim a saved file", async ({
  page,
}) => {
  await page.getByRole("button", { name: "문서", exact: true }).click();
  await page.getByRole("button", { name: "촬영", exact: true }).click();
  await expect(page.getByRole("banner").getByText("1페이지", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "완료", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PDF 내보내기 안내" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /검색 가능한 PDF/ }),
  ).toBeDisabled();
  await expect(page.getByText("검색 가능한 PDF로 저장했어요")).toHaveCount(0);
});

test("OCR sample copies to clipboard and application emits no console errors", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "촬영", exact: true }).click();
  await page.getByRole("heading", { name: "스캔 미리보기" }).waitFor();
  await page.getByRole("button", { name: "OCR 데모" }).click();
  await expect(page.getByText("샘플 텍스트", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "텍스트 복사" }).click();
  await expect(page.getByText("샘플 텍스트를 복사했어요")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "작은 순간이 큰 변화를 만든다.",
  );
  expect(errors).toEqual([]);
});

test("Pixel capture controls stay inside the app viewport", async ({ page }) => {
  await page.getByRole("button", { name: "Preview device: iPhone" }).click();
  await page.getByTestId("device-option-pixel-10").click();
  const viewport = await page.getByTestId("mobile-app-viewport").boundingBox();
  const shutter = await page.getByRole("button", { name: "촬영", exact: true }).boundingBox();
  expect(viewport).not.toBeNull();
  expect(shutter).not.toBeNull();
  expect(shutter!.y + shutter!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
});
