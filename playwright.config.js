import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:8123" },
  webServer: {
    command: "python3 -m http.server 8123 --directory site",
    url: "http://localhost:8123",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
