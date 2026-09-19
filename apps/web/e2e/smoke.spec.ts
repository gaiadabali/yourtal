import { expect, test } from "@playwright/test";

// Proves the harness itself works — a real browser reaches a real build —
// before any acceptance criterion is asserted against it.
test("the app serves its home route in a real browser", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
});
