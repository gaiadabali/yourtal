import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Load a page and wait until its client code has loaded. A click before React
 * hydrates does nothing, which a fast local machine never shows and a cold CI
 * runner always does.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** Click until `opened` appears: hydration can still lag a moment after the network is idle. */
export async function clickUntilVisible(trigger: Locator, opened: Locator): Promise<void> {
  await expect(async () => {
    // Once it is open, a second click would land on the modal overlay instead.
    if (await opened.isVisible()) return;
    await trigger.click({ timeout: 2_000 });
    await expect(opened).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}
