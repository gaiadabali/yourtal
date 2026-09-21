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
 * Scope: every route `ConsoleShell` (`features/console/console-shell.tsx`)
 * serves under `app/(app)/business/**`, since YT-0440's own report already
 * names this shell as the thing that was built fluid but never
 * real-browser-checked. Each route is also loaded once through the
 * consumer's shared `app/(app)/layout.tsx` — the console nests inside the
 * five-tab consumer shell (see YT-0440's report), so a real check has to
 * measure the composed page, not the console in isolation.
 */

test.use({ viewport: { width: 768, height: 1024 } });

const BUSINESS_ROUTES: readonly string[] = [
  "/business",
  "/business/campaigns",
  "/business/inventory",
  "/business/redemption",
  "/business/reports",
  "/business/team",
  "/business/billing",
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

test("business console zone tabs wrap rather than overflow at 768px", async ({ page }) => {
  await page.goto("/business");
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
