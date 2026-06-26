import { test, expect } from "@playwright/test";
import { gotoApp, seedProgress, loadData } from "./helpers.js";

const { alphabet } = loadData();

test("reveal a letter, mark known, badge increments", async ({ page }) => {
  const first = alphabet[0].cyrillic;
  // Seed the first letter as a due "learning" card (reps 1) so ONE correct grade
  // promotes it to "known" (the scheduler needs reps>=2 for "known").
  await seedProgress(page, {
    letters: { [first]: { due: 0, reps: 1, state: "learning" } },
    counter: 1,
  });
  await gotoApp(page);
  await expect(page.locator("#b-alpha")).toContainText("0 / 33");

  await page.locator('[data-go="alphabet"]').click();
  await expect(page.locator(".qcard .big")).toHaveText(first);

  await page.locator("#a-reveal").click();
  await expect(page.locator(".answer .ipa")).toBeVisible();

  await page.locator("#a-got").click();
  await page.locator("#back").click();
  await expect(page.locator("#b-alpha")).toContainText("1 / 33");
});
