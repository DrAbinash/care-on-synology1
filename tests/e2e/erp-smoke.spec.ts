import { expect, test } from "@playwright/test";

test("ERP login shell is reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/Care|Diagnostic|ERP/i);
  await expect(page.getByText(/staff login|login|portal/i).first()).toBeVisible();
});

test("public portal route does not crash", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.locator("body")).toContainText(/Care|Diagnostics|Portal|Login/i);
});
