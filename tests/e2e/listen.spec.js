import { test, expect } from "@playwright/test";
import { gotoApp, seedProgress, knownVocab, loadData, firstGloss } from "./helpers.js";

const { words } = loadData();

test("listen plays a resolvable clip and validates the typed meaning", async ({ page }) => {
  // Seed exactly one known word so the shown word is deterministic (words[0]).
  await seedProgress(page, { vocab: knownVocab([1]) });
  await gotoApp(page);

  // Pressing play must fire a request to a real audio clip (audio-key resolves).
  const audioReq = page.waitForRequest(/\/audio\/.*\.mp3/, { timeout: 8000 });
  await page.locator('[data-go="listen"]').click();
  await page.locator("#li-speak").click();
  await audioReq;

  await page.locator("#lans").fill(firstGloss(words[0].gloss_en));
  await page.locator("#lcheck").click();
  await expect(page.locator("#lverdict")).toHaveClass(/good/);
});
