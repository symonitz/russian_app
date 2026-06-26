import { test, expect } from "@playwright/test";
import { gotoApp, loadData, firstGloss } from "./helpers.js";

const { words } = loadData();

test("correct typed meaning is accepted", async ({ page }) => {
  // No progress -> nextReview shows the first word (words[0]).
  await gotoApp(page);
  await page.locator('[data-go="reviews"]').click();
  await expect(page.locator(".qcard .big")).toHaveText(words[0].stressed);
  await page.locator("#ans").fill(firstGloss(words[0].gloss_en));
  await page.locator("#check").click();
  await expect(page.locator("#verdict")).toHaveClass(/good/);
  await expect(page.locator("#next")).toBeVisible();
});

test("wrong meaning is rejected and offers 'I was right'", async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-go="reviews"]').click();
  await page.locator("#ans").fill("zzzznotaword");
  await page.locator("#check").click();
  await expect(page.locator("#verdict")).toHaveClass(/bad/);
  await expect(page.locator("#iwr")).toBeVisible();
  await expect(page.locator("#next")).toBeVisible();
});
