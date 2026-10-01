import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 13.22.g live: an ops staffer cancels an open charity auction at
 * /staff/auctions with a reason; the bid is released and the voucher goes
 * back to the seller. The charity and voucher are SQL fixtures on this slot's
 * own database (as in auction.e2e.test.ts); listing and bidding use the API.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name}: source this worktree's .env`);
  return value;
}

async function account(request: APIRequestContext, region: "AU" | "ID") {
  const api = env("API_INTERNAL_URL");
  const email = `c-auction-${randomUUID()}@example.test`;
  const password = "c-auction-not-a-real-secret-1";
  const registered = await request.post(`${api}/api/auth/register`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      ...{ email, password, region, locale: region === "AU" ? "en-AU" : "id-ID" },
      ...{ displayName: "Auction E2E", dateOfBirth: "1990-01-01" },
      timezone: region === "AU" ? "Australia/Sydney" : "Asia/Jakarta",
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  return (await registered.json()) as { userId: string; token: string };
}

async function pageAs(browser: Browser, baseURL: string, token: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([{ name: "yt_session", value: token, url: baseURL }]);
  return context.newPage();
}

async function seedCharityAndVoucher(pool: Pool, adminId: string, ownerId: string) {
  const charityId = randomUUID();
  await pool.query(
    `INSERT INTO charity.charity (id, region, name, cause, summary, registration,
       payout_account_name, payout_account_last4, kyb_reference, payout_reference, state,
       applied_by, decided_by, decided_at)
     VALUES ($1, 'ID', 'Yayasan Pelita', 'education', 'Buku untuk sekolah desa.', $2,
       'Yayasan Pelita', '4321', 'simkyb', $3, 'approved', $4, 'staff', now())`,
    [
      charityId,
      JSON.stringify({ kind: "id_yayasan", deedNumber: "AHU-9", fundraisingPermitNumber: "PUB-9" }),
      `simpayout_${randomUUID().slice(0, 8)}`,
      adminId,
    ],
  );
  const listingId = randomUUID();
  await pool.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
       transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status, currency,
       region, audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Kopi Nusantara', 'Kopi susu voucher', 'e2e', 'food_beverage', 50000, 15000,
       1000, 10, 10, true, 'single_use_forfeit', NULL, now() + interval '90 days', 'available',
       'IDR', 'ID', 'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/p.jpg', 'both', 'single_use')`,
    [listingId, randomUUID()],
  );
  const voucherId = randomUUID();
  const code = randomUUID().replace(/-/g, "").slice(0, 16);
  await pool.query(
    `INSERT INTO platform.voucher_fake_voucher
       (id, listing_id, saga_id, owner_id, code, code_hash, state, remaining_value_minor, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'activated', 50000, now() + interval '90 days')`,
    [
      voucherId,
      listingId,
      randomUUID(),
      ownerId,
      code,
      createHash("sha256").update(code).digest("hex"),
    ],
  );
  return { charityId, voucherId };
}

test("ops cancel an open auction with a reason; the bid is released and the voucher returns", async ({
  browser,
  request,
  baseURL,
}) => {
  const api = env("API_INTERNAL_URL");
  const pool = new Pool({ connectionString: env("DATABASE_OWNER_URL") });
  try {
    const [seller, bidder, admin, ops] = [
      await account(request, "ID"),
      await account(request, "ID"),
      await account(request, "ID"),
      await account(request, "AU"),
    ];
    await pool.query(`UPDATE identity.credential SET verified_at = now() WHERE user_id = ANY($1)`, [
      [seller.userId, bidder.userId],
    ]);
    await pool.query(
      `INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, 'ops', 'c-auction-spec')`,
      [ops.userId],
    );
    const { charityId, voucherId } = await seedCharityAndVoucher(pool, admin.userId, seller.userId);
    const listed = await request.post(`${api}/api/wallet/vouchers/${voucherId}/auction`, {
      headers: { authorization: `Bearer ${seller.token}`, "idempotency-key": randomUUID() },
      data: { charityId },
    });
    expect(listed.ok(), await listed.text()).toBeTruthy();
    const { auctionId } = (await listed.json()) as { auctionId: string };
    const bid = await request.post(`${api}/api/auctions/${auctionId}/bids`, {
      headers: { authorization: `Bearer ${bidder.token}`, "idempotency-key": randomUUID() },
      data: { amountMinor: 30000 },
    });
    expect(bid.ok(), await bid.text()).toBeTruthy();

    const page = await pageAs(browser, baseURL as string, ops.token);
    await page.goto("/staff/auctions");
    const card = page.getByRole("listitem").filter({ hasText: "Kopi susu voucher" }).first();
    await expect(card).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      for (const width of [390, 1280]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: `test-results/c-staff-auctions-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
      }
    }
    await card.getByRole("button", { name: "Cancel auction" }).click();
    await page.getByLabel(/reason/i).fill("Seller reported the voucher stolen");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel auction" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const { rows } = await pool.query(
      `SELECT a.state, v.owner_id, (SELECT array_agg(state) FROM auction.bid b WHERE b.auction_id = a.id) AS bids
         FROM auction.auction a
         JOIN platform.voucher_fake_escrow e ON e.auction_id = a.id
         JOIN platform.voucher_fake_voucher v ON v.id = e.voucher_id
        WHERE a.id = $1`,
      [auctionId],
    );
    expect(rows).toEqual([{ state: "cancelled", owner_id: seller.userId, bids: ["released"] }]);
  } finally {
    await pool.end();
  }
});
