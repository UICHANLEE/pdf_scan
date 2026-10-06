import { expect, test, type Page } from "@playwright/test";

const databaseName = "quiet-capture-scans";

async function clearDocuments(page: Page): Promise<void> {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("IndexedDB cleanup was blocked"));
      }),
    databaseName,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await clearDocuments(page);
});

test("persists the cleanup baseline across reload and document lookup", async ({
  page,
}) => {
  const cleanupBaseline = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 12;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#f0c080";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const baseline = canvas.toDataURL("image/jpeg", 0.92);
    const image = canvas.toDataURL("image/jpeg", 0.7);
    const storage = await import(
      new URL("/src/scanner/storage.ts", window.location.href).href
    );
    await storage.saveDocument({
      id: "cleanup-baseline-document",
      title: "Undo baseline fixture",
      createdAt: 100,
      updatedAt: 200,
      tags: [],
      pages: [
        {
          id: "cleanup-baseline-page",
          image,
          original: baseline,
          cleanupOriginal: baseline,
          filter: "document",
        },
      ],
    });
    return baseline;
  });

  await page.reload();
  const persisted = await page.evaluate(async () => {
    const storage = await import(
      new URL("/src/scanner/storage.ts", window.location.href).href
    );
    return storage.getDocument("cleanup-baseline-document");
  });

  expect(persisted?.pages[0].cleanupOriginal).toBe(cleanupBaseline);
});

test("rejects a cleanup baseline that is not a JPEG or PNG data URL", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const validImage = canvas.toDataURL("image/jpeg");
    const storage = await import(
      new URL("/src/scanner/storage.ts", window.location.href).href
    );
    try {
      await storage.saveDocument({
        id: "invalid-cleanup-document",
        title: "Invalid cleanup baseline",
        createdAt: 100,
        updatedAt: 200,
        tags: [],
        pages: [
          {
            id: "invalid-cleanup-page",
            image: validImage,
            original: validImage,
            cleanupOriginal: "https://example.test/cleanup.jpg",
            filter: "original",
          },
        ],
      });
      return { rejected: false, message: "" };
    } catch (error) {
      return {
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  expect(result.rejected).toBe(true);
  expect(result.message).toMatch(/JPEG|PNG|이미지|데이터/i);
});

test("rejects an oversized cleanup baseline before data URL parsing", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const validImage = canvas.toDataURL("image/jpeg");
    const storage = await import(
      new URL("/src/scanner/storage.ts", window.location.href).href
    );
    // The input is intentionally malformed and over the cap. Validation should
    // reject on length before attempting the data URL/base64 regular expression.
    const oversizedMalformedValue = "x".repeat(140 * 1024 * 1024);
    try {
      await storage.saveDocument({
        id: "oversized-cleanup-document",
        title: "Oversized cleanup baseline",
        createdAt: 100,
        updatedAt: 200,
        tags: [],
        pages: [
          {
            id: "oversized-cleanup-page",
            image: validImage,
            original: validImage,
            cleanupOriginal: oversizedMalformedValue,
            filter: "original",
          },
        ],
      });
      return { rejected: false, message: "" };
    } catch (error) {
      return {
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  expect(result.rejected).toBe(true);
  expect(result.message).toMatch(/용량|100MB|너무 큽니다/i);
});

test("deleting a document removes its cleanup baseline with the record", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const image = canvas.toDataURL("image/jpeg");
    const storage = await import(
      new URL("/src/scanner/storage.ts", window.location.href).href
    );
    await storage.saveDocument({
      id: "delete-cleanup-document",
      title: "Delete cleanup fixture",
      createdAt: 100,
      updatedAt: 200,
      tags: [],
      pages: [
        {
          id: "delete-cleanup-page",
          image,
          original: image,
          cleanupOriginal: image,
          filter: "original",
        },
      ],
    });
    await storage.deleteDocument("delete-cleanup-document");
    return storage.getDocument("delete-cleanup-document");
  });

  expect(result).toBeUndefined();
});
