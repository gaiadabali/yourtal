import { expect, test } from "@playwright/test";

/**
 * YT-0440's tablet-width acceptance criterion: "usable at tablet width; no
 * horizontal scrolling." 768px is chosen the same way `overflow-320.spec.ts`
 * chose 320px — as the narrowest width the category actually ships (iPad
 * Mini/Air/Pro all report 768px or more in portrait), so passing here is the
 * harder case and a safe floor for every wider tablet.
 *
 * Checked the honest way, same as `overflow-320.spec.ts`:
 * `document.documentElement.scrollWidth <= clientWidth`. Any horizontal
 * scrollbar at all fails this, full stop — it is not a visual diff or a
 * screenshot comparison.
 *
 * Scope: every route `StudioChrome` (`features/studio/studio-chrome.tsx`)
 * serves under `app/(business)/studio/**` (task 7.8.a moved this from
 * `(app)/business/**`; `route-redirects.ts` sends the old paths here for a
 * signed-in visitor). `(business)` is its own root layout now, not nested
 * inside the viewer's five-tab shell, but the check itself — no horizontal
 * scroll at 768px — still matters exactly as much.
 */

test.use({ viewport: { width: 768, height: 1024 } });

const BUSINESS_ROUTES: readonly string[] = [
  "/studio",
  "/studio/campaigns",
  "/studio/inventory",
  "/studio/reports",
  "/studio/team",
  "/studio/billing",
];

for (const route of BUSINESS_ROUTES) {
  test(`${route} has no horizontal overflow at 768px (tablet)`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok(), `${route} should respond ok`).toBe(true);
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflow.scrollWidth,
      `${route}: scrollWidth ${overflow.scrollWidth}px exceeds clientWidth ${overflow.clientWidth}px — something overflows the 768px tablet viewport`,
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

test("Studio zone tabs wrap rather than overflow at 768px", async ({ page }) => {
  await page.goto("/studio");
  await page.waitForLoadState("networkidle");

  const nav = page.getByRole("navigation").filter({ hasText: /./ }).last();
  const box = await nav.boundingBox();
  expect(box, "the zone-tab nav should have a measurable box").not.toBeNull();
  if (box) {
    expect(
      box.x + box.width,
      "zone-tab nav must not extend past the 768px viewport",
    ).toBeLessThanOrEqual(768);
  }
});
