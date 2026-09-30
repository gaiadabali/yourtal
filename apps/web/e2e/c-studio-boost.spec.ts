import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 13.23.a/c/d live: a live campaign's Boost tab saves a budget and bid over
 * the real API; Reports shows its boost delivery and Billing its charges.
 * Going live (moderation) and a day's delivery are SQL stand-ins here; the
 * auction and the charge are proven in boost.e2e.test.ts and
 * boost-settle.test.ts. 390 and 1280 px, light and dark, axe clean.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name}: source this worktree's .env`);
  return value;
}

async function ownerWithBusiness(request: APIRequestContext) {
  const api = env("API_INTERNAL_URL");
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `c-boost-${suffix}@example.test`;
  const password = "c-studio-boost-not-a-real-secret-1";
  const registered = await request.post(`${api}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: "Boost E2E" },
      ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const login = await request.post(`${api}/api/auth/login`, { data: { email, password } });
  const cookie = `yt_session=${((await login.json()) as { token: string }).token}`;
  const business = await request.post(`${api}/api/businesses`, {
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ legalName: "Harbour Beans Pty Ltd", displayName: "Harbour Beans" },
      ...{ taxIdKind: "ABN", taxIdValue: "51824753556", addressState: "NSW" },
      ...{ addressPostcode: "2000", roles: ["advertiser", "supplier"], region: "AU" },
      handle: `harbour-boost-${suffix}`.slice(0, 40),
    },
  });
  expect(business.ok(), await business.text()).toBeTruthy();
  const businessId = ((await business.json()) as { business: { id: string } }).business.id;
  const draft = await request.post(`${api}/api/${businessId}/studio/campaigns`, {
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ kind: "quick", title: "Morning flat white", synopsis: "Our barista's morning." },
      ...{ durationSeconds: 30, contentCategory: "food-and-drink", audience: "all_ages" },
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      ...{ openViewing: false, teaserStartSeconds: 0, declaredInterests: ["coffee"] },
    },
  });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  return { cookie, businessId, campaignId: ((await draft.json()) as { id: string }).id };
}

/** Moderation's approval and a day of delivery, by SQL on this slot's own database. */
async function goLiveWithHistory(pool: Pool, campaignId: string, businessId: string) {
  await pool.query(
    `UPDATE campaign.campaigns SET poster_url = 'https://cdn.example.com/p.jpg',
       teaser_url = 'https://cdn.example.com/t.mp4', hls_url = 'https://cdn.example.com/m.m3u8',
       aspect = '9:16', estimated_bytes = 1000000, estimated_data_mb = 10, reward_points = 3,
       question_count = 0, scoring_rule = 'base_only', lifecycle_state = 'in_review' WHERE id = $1`,
    [campaignId],
  );
  await pool.query(`UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = $1`, [
    campaignId,
  ]);
  return async () => {
    const yesterday = `(now() AT TIME ZONE 'Australia/Sydney')::date - 1`;
    await pool.query(
      `INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli)
       VALUES ($1, ${yesterday}, 1200, 300000)`,
      [campaignId],
    );
    await pool.query(
      `INSERT INTO feed.boost_impression (campaign_id, region, day, slot, price_cpm_minor)
       SELECT $1, 'AU', ${yesterday}, 0, 250 FROM generate_series(1, 1200)`,
      [campaignId],
    );
    await pool.query(
      `INSERT INTO feed.boost_charge (campaign_id, business_id, region, currency, day,
         impressions, amount_minor, provider_reference)
       VALUES ($1, $2, 'AU', 'AUD', ${yesterday}, 1200, 300, 'sim_boost_demo')`,
      [campaignId, businessId],
    );
  };
}

async function capture(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `test-results/c-studio-boost-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

test("a live campaign's boost is set in Studio, and shows in Reports and Billing", async ({
  page,
  request,
  baseURL,
}) => {
  const pool = new Pool({ connectionString: env("DATABASE_OWNER_URL") });
  try {
    const owner = await ownerWithBusiness(request);
    const addHistory = await goLiveWithHistory(pool, owner.campaignId, owner.businessId);
    const [name, value] = owner.cookie.split("=");
    await page
      .context()
      .addCookies([{ name: name as string, value: value as string, url: baseURL as string }]);

    await page.goto("/studio/campaigns");
    await page.getByRole("button", { name: /Morning flat white/ }).click();
    await page.getByRole("tab", { name: "Boost" }).click();
    await page.getByLabel("Daily budget (AUD)").fill("5.00");
    await page.getByLabel("Maximum bid per 1,000 impressions (AUD)").fill("2.50");
    await page.getByRole("button", { name: "Save boost" }).click();
    await expect(page.getByRole("status")).toHaveText("Boost saved.");
    await capture(page, "tab");

    const { rows } = await pool.query(
      `SELECT daily_budget_minor, max_bid_cpm_minor, currency, state FROM feed.boost
        WHERE campaign_id = $1`,
      [owner.campaignId],
    );
    expect(rows).toEqual([
      { daily_budget_minor: "500", max_bid_cpm_minor: "250", currency: "AUD", state: "active" },
    ]);

    await addHistory();
    await page.goto("/studio/reports");
    await expect(page.getByRole("heading", { name: "Boost" })).toBeVisible();
    await expect(page.getByText("1200")).toBeVisible();
    await capture(page, "reports");

    await page.goto("/studio/billing");
    await expect(page.getByRole("heading", { name: "Boost charges" })).toBeVisible();
    await capture(page, "billing");
  } finally {
    await pool.end();
  }
});
