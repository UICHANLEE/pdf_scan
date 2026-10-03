import { defineConfig } from "@playwright/test";

// Exercise the built application (including emitted worker URLs and CSP),
// not the development module endpoints used by engine-specific tests.
export default defineConfig({
  testDir: "./tests",
  testMatch: "scanner.spec.ts",
  grep: /imports real images|saves locally|downloads a valid image PDF|runs real OCR/,
  timeout: 90_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4185", viewport: {width:1100,height:1100} },
  webServer: {
    command: "npm exec vite -- preview --host 127.0.0.1 --port 4185 --strictPort",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: false,
  },
});
