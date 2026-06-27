import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers.js";

test("home renders all five modes once data loads", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".hello")).toHaveText("Привет!");
  for (const m of ["learn", "reviews", "listen", "reading", "patterns"]) {
    await expect(page.locator(`[data-go="${m}"]`)).toBeVisible();
  }
});
