import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * 5.1.a: after "Buy", a processor that settles at once (the simulated driver)
 * comes straight back with `purchased=1`; Stripe (on staging, the payment
 * simulation) sends the browser to its checkout page first. This pays there
 * with Stripe's 4242 test card and waits until Billing says the points were
 * added, which happens when the webhook lands.
 */
export async function finishPurchase(page: Page, pointsAdded: string): Promise<void> {
  await page.waitForURL(/purchased=1|error=|\/checkout\/cs_/);
  if (/\/checkout\/cs_/.test(page.url())) {
    await page.locator('input[name="number"]').fill("4242 4242 4242 4242");
    await page.locator('input[name="expiry"]').fill("12 / 34");
    await page.locator('input[name="cvc"]').fill("123");
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL(/\/studio\/billing\?.*purchase=/);
  }
  await expect(page.getByText(pointsAdded)).toBeVisible({ timeout: 60_000 });
}
