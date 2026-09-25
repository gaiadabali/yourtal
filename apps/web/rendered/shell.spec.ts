import { expect, test } from "@playwright/test";

const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

/**
 * 3.5.e (second half): nothing in the viewer shell links to `/business`
 * (requested by C), and the breakpoint the shell promises actually holds in
 * a real browser — bottom tabs below 1024px, the side rail from 1024px up.
 * `/store` renders today with no session (task 3.5.d, which would move `/`
 * behind a redirect, is blocked), so it is the cheapest real `(app)` route
 * to check the shell against.
 */
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`viewer shell at ${name} (${viewport.width}px)`, () => {
    test.use({ viewport });

    test("no shell link points at /business", async ({ page }) => {
      await page.goto("/store");
      const hrefs = await page
        .locator("nav a[href], header a[href]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href, `shell link "${href}" must not point at /business`).not.toMatch(
          /^\/business(?:\/|$)/,
        );
      }
    });
  });
}

test("the bottom nav is visible at 390px and the side nav at 1280px", async ({ page }) => {
  await page.goto("/store");

  await page.setViewportSize(VIEWPORTS.mobile);
  const primaryNavs = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNavs).toHaveCount(1);
  const bottomBox = await primaryNavs.first().boundingBox();
  expect(bottomBox, "bottom nav should have a layout box at 390px").not.toBeNull();
  if (bottomBox) {
    // The bottom nav is fixed to the bottom edge of a 390x844 viewport.
    expect(bottomBox.y + bottomBox.height).toBeGreaterThan(800);
  }

  await page.setViewportSize(VIEWPORTS.desktop);
  await expect(primaryNavs).toHaveCount(1);
  const sideBox = await primaryNavs.first().boundingBox();
  expect(sideBox, "side nav should have a layout box at 1280px").not.toBeNull();
  if (sideBox) {
    // The side rail is pinned to the left edge and taller than it is wide.
    expect(sideBox.x).toBeLessThan(20);
    expect(sideBox.height).toBeGreaterThan(sideBox.width);
  }
});
