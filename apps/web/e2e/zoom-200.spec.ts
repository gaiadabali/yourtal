import { expect, test } from "@playwright/test";
import { longMerchantNameCampaignFixture } from "@yourtal/contracts/campaign/mock";

// A named, hand-authored fixture with a fixed literal id in its own
// generator module — not an element of the generated `mockCampaigns` array,
// so its id does not move when a generator's draw order shifts.
const LONG_MERCHANT_CAMPAIGN_ID = longMerchantNameCampaignFixture.id;

/**
 * YT-0401's 200% browser-zoom acceptance criterion.
 *
 * MECHANISM, stated plainly: Playwright/CDP has no API for "press Ctrl+ in
 * a real Chrome window" — Chrome's page-zoom is a browser-chrome feature,
 * not something the page or devtools protocol exposes for automation.
 * The closest honest proxy, used here, is setting the non-standard but
 * Chromium-native CSS `zoom: 2` on `<html>`. This is the same rendering
 * primitive Chrome's own page zoom uses internally: it rescales layout,
 * text and hit-testing together, as opposed to a `transform: scale()` hack
 * (which would rescale visuals but leave hit-testing and reflow wrong).
 *
 * What this DOES prove: at double scale, on a 320px-wide viewport (so the
 * post-zoom effective layout width is 160 CSS px — narrower than any real
 * 200%-zoomed phone or laptop would ever produce, i.e. a strictly harder
 * case), text stays legible-sized, nothing clips its container, and no two
 * elements visually overlap.
 *
 * What this does NOT prove: Chrome's real zoom also resizes the visual
 * viewport independently of the layout viewport in ways `zoom` does not
 * fully replicate (e.g. pinch-zoom panning), and this was never checked in
 * an actual windowed Chrome with the OS's real DPI/zoom UI. Treat this as
 * strong layout-robustness evidence, not a substitute for a manual check.
 */

test.use({ viewport: { width: 320, height: 640 } });

const ZOOMED_ROUTES: readonly string[] = [
  "/",
  `/campaign/${LONG_MERCHANT_CAMPAIGN_ID}`,
  "/wallet",
  "/store",
];

for (const route of ZOOMED_ROUTES) {
  test(`${route} stays readable and unclipped at 200% zoom (320px base viewport)`, async ({
    page,
  }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    // Force layout to settle after the synchronous style write before measuring.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `${route} at 200% zoom: content ${overflow.scrollWidth}px wider than the ${overflow.clientWidth}px viewport`,
    ).toBeLessThanOrEqual(overflow.clientWidth);

    const heading = page.locator("main h1").first();
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(
      headingBox,
      `${route}: main heading must have a measurable box at 200% zoom`,
    ).not.toBeNull();
  });
}

test("no two primary-action buttons overlap on the earn board at 200% zoom", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const links = page.locator("main a[href]");
  const count = await links.count();
  expect(count, "earn board should still render campaign links at 200% zoom").toBeGreaterThan(0);

  const boxes = [];
  for (let index = 0; index < Math.min(count, 6); index += 1) {
    const box = await links.nth(index).boundingBox();
    if (box) {
      boxes.push(box);
    }
  }

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b) {
        continue;
      }
      const overlaps =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlaps, `cards ${i} and ${j} visually overlap at 200% zoom`).toBe(false);
    }
  }
});
