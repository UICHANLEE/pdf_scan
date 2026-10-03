import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("fake camera waits for a video frame, captures it, and stops its track on navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const stream = await original(constraints);
        (
          window as Window & { __scannerTestStream?: MediaStream }
        ).__scannerTestStream = stream;
        return stream;
      },
    });
  });

  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  const video = page.locator("video.live-camera");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement) =>
          element.videoWidth > 0 && element.videoHeight > 0,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "촬영", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "스캔 미리보기" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __scannerTestStream?: MediaStream }
          ).__scannerTestStream
            ?.getVideoTracks()
            .every((track) => track.readyState === "ended") ?? false,
      ),
    )
    .toBe(true);
});
