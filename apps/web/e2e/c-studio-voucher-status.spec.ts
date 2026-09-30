import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 13.10 live: Studio Reports shows the business's own vouchers by status,
 * from GET .../studio/reports/vouchers. Below the cohort floor it says so;
 * above it, the counts. The vouchers are SQL stand-ins for what checkout
 * and gifting write (both proven elsewhere). 390 and 1280 px, light and
 * dark, axe clean.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name}: source this worktree's .env`);
  return value;
}

async function capture(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `test-results/c-studio-voucher-status-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

test("Reports shows a supplier's vouchers by status, floored", async ({
  page,
  request,
  baseURL,
}) => {
  const api = env("API_INTERNAL_URL");
  const pool = new Pool({ connectionString: env("DATABASE_OWNER_URL") });
  try {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `c-vstatus-${suffix}@example.test`;
    const password = "c-studio-voucher-status-not-a-secret-1";
    const registered = await request.post(`${api}/api/auth/register`, {
      headers: { "idempotency-key": crypto.randomUUID() },
      data: {
        ...{ email, password, region: "AU", locale: "en-AU", displayName: "Status E2E" },
        ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
      },
    });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    const login = await request.post(`${api}/api/auth/login`, { data: { email, password } });
    const token = ((await login.json()) as { token: string }).token;
    const business = await request.post(`${api}/api/businesses`, {
      headers: { cookie: `yt_session=${token}`, "idempotency-key": crypto.randomUUID() },
      data: {
        ...{ legalName: "Harbour Beans Pty Ltd", displayName: "Harbour Beans" },
        ...{ taxIdKind: "ABN", taxIdValue: "51824753556", addressState: "NSW" },
        ...{ addressPostcode: "2000", roles: ["supplier"], region: "AU" },
        handle: `harbour-vstatus-${suffix}`.slice(0, 40),
      },
    });
    expect(business.ok(), await business.text()).toBeTruthy();
    const businessId = ((await business.json()) as { business: { id: string } }).business.id;
    await page.context().addCookies([{ name: "yt_session", value: token, url: baseURL as string }]);

    const listingId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
       VALUES ($1, $2, 'Harbour Beans', '1 George St', 'Sydney')`,
      [locationId, businessId],
    );
    await pool.query(
      `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
         face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
         transferable, partial_redemption_policy, expires_at, status, currency, region, audience,
         content_category, image_url, channel, partial_redemption)
       VALUES ($1, $2, 'Harbour Beans', 'Flat white', 'e2e', 'food_beverage', 550, 400, 500,
         20, 20, true, 'single_use_forfeit', now() + interval '90 days', 'available', 'AUD', 'AU',
         'all_ages', 'food-and-drink', 'https://cdn.example.com/p.jpg', 'both', 'single_use')`,
      [listingId, businessId],
    );
    await pool.query(
      `INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
      [listingId, locationId],
    );
    const addVouchers = (states: readonly [string, string | null][]) =>
      Promise.all(
        states.map(([state, reason]) =>
          pool.query(
            `INSERT INTO voucher.vouchers (id, listing_id, owner_id, merchant_id, merchant_name,
               title, face_value_minor, remaining_value_minor, partial_redemption_policy,
               transferable, issued_at, expires_at, location_id, state, void_reason, currency, region)
             VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, 'Harbour Beans', 'Flat white',
               550, CASE WHEN $3 = 'redeemed' THEN 0 ELSE 550 END, 'single_use_forfeit', true,
               now(), now() + interval '90 days', $4, $3, $5, 'AUD', 'AU')`,
            [listingId, businessId, state, locationId, reason],
          ),
        ),
      );

    await addVouchers([
      ["active", null],
      ["redeemed", null],
    ]);
    await page.goto("/studio/reports");
    await expect(page.getByText(/Too few vouchers so far/)).toBeVisible();
    await capture(page, "suppressed");

    await addVouchers([
      ...Array.from({ length: 6 }, () => ["redeemed", null] as [string, null]),
      ...Array.from({ length: 3 }, () => ["active", null] as [string, null]),
      ["voided", "transfer"],
    ]);
    await page.goto("/studio/reports");
    const table = page.getByRole("table", { name: /Vouchers by status/ });
    await expect(table.getByRole("row", { name: /Redeemed 7/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /Passed on 1/ })).toBeVisible();
    await capture(page, "counted");
  } finally {
    await pool.end();
  }
});
