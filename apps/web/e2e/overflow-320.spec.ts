import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  longMerchantNameCampaignFixture,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import { abovePlausibleBalanceListingFixture } from "@yourtal/contracts/listing/mock";
import { pinRegionCookie } from "./pin-region";

/**
 * `features/region/get-region.ts`'s `DEFAULT_REGION` was "ID"
 * (id-ID) and is now "AU" (task 0.5.a) — this suite pins the region cookie
 * to "ID" below (`test.beforeEach`) so it keeps exercising the `id-ID`
 * catalogue it was written against, rather than picking up whichever
 * locale happens to be the cookie-less default. The primary nav's
 * `aria-label` (YT-0058's nav i18n) is read out of that SAME pinned
 * locale's catalogue file, not a hardcoded English "Primary" — reading it
 * from the same catalogue the component itself renders from means this
 * test tracks a copy change instead of silently asserting a locale that no
 * longer applies. Read via `fs`, not a bare `import ... from "*.json"`:
 * Playwright's own Node/ESM runtime rejects an un-attributed JSON import
 * ("needs an import attribute of type: json") — a Next.js-loader feature,
 * not a Node one, per wallet-merchant-qr-agreement.spec.ts's identical note.
 */
interface NavCatalogue {
  primary: string;
}
const PINNED_REGION = "ID";
const idNav = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/id-ID/nav.json", import.meta.url)), "utf-8"),
) as NavCatalogue;

test.beforeEach(async ({ context, baseURL }) => {
  await pinRegionCookie(context, PINNED_REGION, baseURL!);
});

// These three are named, hand-authored fixtures with fixed literal ids in
// their own generator modules (`campaign.mock.ts`, `listing.mock.ts`) — NOT
// elements of the generated `mockCampaigns`/`mockListings` arrays, so
// nothing about their id depends on the seeded faker's draw order. Importing
// the fixture by name and reading its own `.id` is the direct route; there
// is no "wrong draw" for a generator's changing to invalidate.
const LONG_MERCHANT_CAMPAIGN_ID = longMerchantNameCampaignFixture.id;
const LONG_FORM_CAMPAIGN_ID = zeroRewardCampaignFixture.id;
const LONG_MERCHANT_LISTING_ID = abovePlausibleBalanceListingFixture.id;

/**
 * YT-0401's 320 px acceptance criterion. `mobile-320` (see
 * playwright.config.ts) is the project intended to run this file, so a
 * failure names the viewport — but `test.use` below pins the viewport
 * explicitly too, so the checks are correct even when run under the
 * desktop `chromium` project (Tailwind's `md:hidden` etc. react to the
 * real viewport, so without this pin the bottom-nav and touch-target
 * assertions below would silently measure the desktop side-nav instead).
 *
 * "No horizontal overflow" is checked the honest way per the ticket:
 * `document.documentElement.scrollWidth <= clientWidth`, not a visual diff.
 * Any pixel of horizontal scroll means something on the page is wider than
 * the device, full stop.
 *
 * Every route this app owns under `app/(app)` and `app/(merchant)` is
 * checked, plus the two long-merchant-name fixtures
 * (`longMerchantNameCampaignFixture`, `abovePlausibleBalanceListingFixture`)
 * routed to directly, since `packages/ui`'s primitives were built claiming
 * 320 px safety without ever being rendered.
 */

test.use({ viewport: { width: 320, height: 640 } });

const ROUTES: readonly string[] = [
  "/",
  `/campaign/${LONG_MERCHANT_CAMPAIGN_ID}`,
  `/watch/${LONG_FORM_CAMPAIGN_ID}`,
  `/watch/${LONG_FORM_CAMPAIGN_ID}/checkpoint`,
  "/store",
  `/store/${LONG_MERCHANT_LISTING_ID}`,
  "/wallet",
  "/quick",
  "/merchant",
  "/business",
  "/onboarding",
];

for (const route of ROUTES) {
  test(`${route} has no horizontal overflow at 320px`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok(), `${route} should respond ok`).toBe(true);
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflow.scrollWidth,
      `${route}: scrollWidth ${overflow.scrollWidth}px exceeds clientWidth ${overflow.clientWidth}px — something overflows the 320px viewport`,
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

test("earn board renders the 78-char long merchant name without overflow", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const card = page.getByText(/Warung Kopi Kenangan Manis Nusantara Jaya Abadi Sentosa/i).first();
  await expect(card).toBeVisible();

  const box = await card.boundingBox();
  expect(box, "long merchant name element should have a layout box").not.toBeNull();
  if (box) {
    expect(
      box.x + box.width,
      "long merchant name must stay within the 320px viewport",
    ).toBeLessThanOrEqual(320);
  }
});

test("campaign entry card for the long-merchant-name fixture stays in-bounds", async ({ page }) => {
  await page.goto(`/campaign/${LONG_MERCHANT_CAMPAIGN_ID}`);
  await page.waitForLoadState("networkidle");

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const primaryAction = page.locator("main button, main a[href]").first();
  await expect(primaryAction).toBeVisible();
  const box = await primaryAction.boundingBox();
  expect(box, "primary action must be measurable").not.toBeNull();
  if (box) {
    expect(box.x, "primary action must not start off-screen left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "primary action must not extend past 320px").toBeLessThanOrEqual(320);
    expect(box.height, "primary action should be a reachable touch target").toBeGreaterThanOrEqual(
      36,
    );
  }
});

test("store listing detail for the long-merchant-name fixture stays in-bounds", async ({
  page,
}) => {
  await page.goto(`/store/${LONG_MERCHANT_LISTING_ID}`);
  await page.waitForLoadState("networkidle");

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("bottom nav's five tabs are all reachable touch targets at 320px", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const nav = page.getByRole("navigation", { name: idNav.primary });
  await expect(nav).toBeVisible();

  const links = nav.getByRole("link");
  const count = await links.count();
  expect(count).toBe(5);

  for (let index = 0; index < count; index += 1) {
    const box = await links.nth(index).boundingBox();
    expect(box, `nav tab ${index} should be measurable`).not.toBeNull();
    if (box) {
      expect(box.width, `nav tab ${index} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `nav tab ${index} height`).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, `nav tab ${index} must not overflow 320px`).toBeLessThanOrEqual(
        320,
      );
    }
  }
});
