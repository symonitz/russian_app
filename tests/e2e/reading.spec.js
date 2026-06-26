import { test, expect } from "@playwright/test";
import { gotoApp, seedProgress, knownVocab } from "./helpers.js";

test("reading is gated until a few words are learned", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-go="reading"]').click();
  await expect(page.locator("#reading-stage")).toContainText("Learn a few words");
});

test("passage shows stress marks and tap-to-gloss resolves", async ({ page }) => {
  await seedProgress(page, { vocab: knownVocab([1, 2, 3, 4, 5, 6, 7, 8]) });
  await gotoApp(page);
  await page.locator('[data-go="reading"]').click();
  await expect(page.locator(".passage")).toBeVisible();

  // Stress marks render in the passage (the accents feature).
  const passage = await page.locator(".passage").textContent();
  expect(passage).toMatch(/́/);

  // Tapping a word resolves its gloss despite the accent marks (guards the
  // stripAccent glossary lookup). Some function words / homographs have no
  // gloss, so accept any token that resolves — if the lookup were broken,
  // NONE would.
  const tokens = page.locator(".rtoken");
  const count = await tokens.count();
  let glossed = false;
  for (let i = 0; i < count; i++) {
    await tokens.nth(i).click();
    if (((await page.locator("#wordpop").textContent()) || "").includes("—")) {
      glossed = true;
      break;
    }
  }
  expect(glossed, "no tapped word resolved a gloss").toBeTruthy();

  // Advancing loads another passage.
  await page.locator("#read-next").click();
  await expect(page.locator(".passage")).toBeVisible();
});
