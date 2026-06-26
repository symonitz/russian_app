import { test, expect } from "@playwright/test";
import { gotoApp, loadData } from "./helpers.js";

const { patterns } = loadData();

test("building the correct sentence reveals the spoken form", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-go="patterns"]').click();
  await expect(page.locator(".prompt-en")).toBeVisible();

  // The first un-met pattern (id 0) is shown; which item is random, so read the
  // prompt and look up its answer in the data.
  const prompt = (await page.locator(".prompt-en").textContent()).trim();
  const item = patterns[0].items.find((it) => it.prompt.trim() === prompt);
  expect(item, `no pattern item matches prompt "${prompt}"`).toBeTruthy();

  // Tap the answer tiles in order (found by exact text in the bank).
  for (const word of item.answer) {
    await page.locator(".ptiles .ptile", { hasText: new RegExp(`^${word}$`) }).first().click();
  }
  await page.locator("#pcheck").click();

  await expect(page.locator("#pverdict")).toHaveClass(/good/);
  await expect(page.locator("#pverdict")).toContainText(item.say);
  await expect(page.locator("#pnext")).toBeVisible();
});
