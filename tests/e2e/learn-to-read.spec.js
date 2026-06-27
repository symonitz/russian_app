import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const LESSONS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "data", "reading_lessons.json"), "utf8")
);

test("Learn to Read: letter card, then word card reveals emoji + audio ONLY on tap", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-go="learn"]').click();
  await page.locator('.lesson-row[data-lesson="1"]').click();

  // First card is a letter intro (the lesson's first letter).
  await expect(page.locator(".letter-card .big")).toContainText(LESSONS[0].letters[0]);
  await expect(page.locator(".letter-hint")).toBeVisible();
  await page.locator("#lc-got").click();

  // Step through remaining letters to reach the first word card.
  for (let i = 0; i < LESSONS[0].letters.length; i++) {
    const got = page.locator("#lc-got");
    if (await got.count()) await got.click();
    else break;
  }

  // Word card: NO audio request before tapping.
  const wordBig = page.locator(".word-card .big");
  await expect(wordBig).toBeVisible();
  let audioFired = false;
  page.on("request", (r) => { if (/\/audio\/.*\.mp3/.test(r.url())) audioFired = true; });
  await page.waitForTimeout(400);
  expect(audioFired, "reading word must not autoplay").toBeFalsy();

  // Tap to check -> emoji reveals AND an audio request fires.
  const audioReq = page.waitForRequest(/\/audio\/.*\.mp3/, { timeout: 5000 });
  await page.locator("#wc-check").click();
  await expect(page.locator(".word-emoji")).toBeVisible();
  await audioReq;
});
