import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Load a page and wait for its load event. Not `networkidle`: some pages keep
 * a request open (in CI there is no API to answer it), so the network never
 * goes idle. Hydration lag is handled where it matters, by retrying the action.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
}

/** Click until `opened` appears: a click before React hydrates does nothing. */
export async function clickUntilVisible(trigger: Locator, opened: Locator): Promise<void> {
  await expect(async () => {
    // Once it is open, a second click would land on the modal overlay instead.
    if (await opened.isVisible()) return;
    await trigger.click({ timeout: 2_000 });
    await expect(opened).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}
