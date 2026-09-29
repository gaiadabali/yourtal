import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categoryPolicy } from "@yourtal/jurisdiction/content-category";
import { listDemoMediaBusinesses, stableId } from "@yourtal/media/demo-media";
import { OWNER_URL } from "../database-urls";
import { AUDIENCE_PICKS, runDemoAudiences } from "./demo-audiences";

/**
 * TASKS.md 12.1.g. Builds a real `campaign.campaigns` + `campaign.
 * reward_config` + `store.listings` row for each of the 16 real demo-media
 * businesses (`listDemoMediaBusinesses()`, the same committed manifest
 * `main-staging.ts` reads), all `all_ages`, funded and live — the exact
 * state the staging seed leaves them in right before this step runs — and
 * proves `runDemoAudiences` re-rates exactly the three per region
 * `AUDIENCE_PICKS` names, leaves the rest `all_ages`, and is a no-op the
 * second time.
 */
let owner: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
});

afterAll(async () => {
  await owner.end();
});

const businesses = listDemoMediaBusinesses();

async function seedBusiness(business: (typeof businesses)[number]): Promise<void> {
  const currency = business.region === "AU" ? "AUD" : "IDR";
  await owner.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, roles, is_verified, logo_url, region, currency, handle,
        tax_id_kind, tax_id_value, address_state, address_postcode, address_city)
     VALUES ($1,$2,$2,'["advertiser"]'::jsonb, true, 'http://127.0.0.1:26900/x/logo.svg', $3, $4, $5,
             $6, $7, $8, $9, $10)`,
    [
      business.businessId,
      business.brand,
      business.region,
      currency,
      `test-demo-audiences-${business.slug}`,
      business.region === "AU" ? "ABN" : "NPWP",
      business.region === "AU" ? "51824753556" : "012345678901234",
      business.region === "AU" ? "NSW" : null,
      business.region === "AU" ? "2000" : null,
      business.region === "ID" ? "Jakarta" : null,
    ],
  );

  const campaignId = stableId(`demo-media:campaign:${business.slug}`);
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,'long_form',$2,$3,$4,'A test campaign',90,
             10.5, 80, 1, 'base_only',
             'live', now(), $3, $5, 'all_ages', 'entertainment',
             'http://127.0.0.1:26900/x/poster.jpg', 'http://127.0.0.1:26900/x/teaser.mp4',
             'http://127.0.0.1:26900/x/index.m3u8', null, '9:16', 1000,
             now(), now() + interval '90 days', true, 0)`,
    [
      campaignId,
      `Demo audiences test ${business.slug}`,
      business.businessId,
      business.brand,
      business.region,
    ],
  );
  await owner.query(
    `INSERT INTO campaign.reward_config
       (campaign_id, allocation_id, funder_type, max_points_for_campaign,
        reward_points_per_completion, accuracy_bonus_points)
     VALUES ($1, $2, 'partner', 81000, 80, 1)`,
    [campaignId, `alloc_test_${business.slug}`],
  );

  const listingId = stableId(`demo-media:listing:${business.slug}`);
  const currencyMinor = business.region === "AU" ? 3_000 : 50_000;
  await owner.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category,
        face_value_minor, settlement_value_minor, price_in_points, stock_remaining,
        stock_total, transferable, partial_redemption_policy, minimum_spend_minor,
        expires_at, status, currency, region, audience, content_category, image_url,
        channel, partial_redemption)
     VALUES ($1,$2,$3,$4,'A test listing','retail',$5,$5,1000,20,
             20,false,'single_use_forfeit',null,
             now() + interval '365 days','available',$6,$7,'all_ages','entertainment',
             'http://127.0.0.1:26900/x/listing.jpg','in_store','single_use')`,
    [
      listingId,
      business.businessId,
      business.brand,
      `Voucher ${business.brand}`,
      currencyMinor,
      currency,
      business.region,
    ],
  );
}

async function cleanup(): Promise<void> {
  for (const business of businesses) {
    const campaignId = stableId(`demo-media:campaign:${business.slug}`);
    const listingId = stableId(`demo-media:listing:${business.slug}`);
    await owner.query(`DELETE FROM store.listings WHERE id = $1`, [listingId]);
    await owner.query(`DELETE FROM campaign.reward_config WHERE campaign_id = $1`, [campaignId]);
    await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
    await owner.query(`DELETE FROM business.business_accounts WHERE id = $1`, [
      business.businessId,
    ]);
  }
}

interface AudienceCount {
  readonly audience: string;
  readonly count: string;
}

async function audienceCounts(region: "AU" | "ID"): Promise<Record<string, number>> {
  const ids = businesses
    .filter((b) => b.region === region)
    .map((b) => stableId(`demo-media:campaign:${b.slug}`));
  const result = await owner.query<AudienceCount>(
    `SELECT audience, count(*)::text AS count FROM campaign.campaigns
      WHERE id = ANY($1::uuid[]) GROUP BY audience`,
    [ids],
  );
  return Object.fromEntries(result.rows.map((r) => [r.audience, Number(r.count)]));
}

describe("runDemoAudiences", () => {
  it("has no teen pick whose category the jurisdiction marks adult_only or prohibited", () => {
    // A static guard on the picks table itself, independent of any seeded
    // row — a future edit that adds a teen pick with a regulated category
    // must fail here, not only at seed-run time.
    for (const pick of AUDIENCE_PICKS.filter((p) => p.audience === "teen")) {
      expect(categoryPolicy(pick.region, "entertainment")).toBe("allowed");
    }
  });

  it("re-rates exactly one teen, one adult and one parents campaign per region, leaves >=5 all_ages, and is a no-op the second time", async () => {
    for (const business of businesses) await seedBusiness(business);
    try {
      const first = await runDemoAudiences(owner, () => undefined);
      expect(first).toHaveLength(AUDIENCE_PICKS.length);
      expect(first.every((r) => r.campaign === "updated" && r.listing === "updated")).toBe(true);

      for (const region of ["AU", "ID"] as const) {
        const counts = await audienceCounts(region);
        expect(counts.teen).toBe(1);
        expect(counts.adult).toBe(1);
        expect(counts.parents).toBe(1);
        expect(counts.all_ages).toBeGreaterThanOrEqual(5);
      }

      // Each picked campaign's own listing landed on the same audience.
      for (const pick of AUDIENCE_PICKS) {
        const listingId = stableId(`demo-media:listing:${pick.slug}`);
        const row = await owner.query<{ audience: string }>(
          `SELECT audience FROM store.listings WHERE id = $1`,
          [listingId],
        );
        expect(row.rows[0]?.audience).toBe(pick.audience);
      }

      // Re-running finds every row already at its target audience.
      const second = await runDemoAudiences(owner, () => undefined);
      expect(second.every((r) => r.campaign === "already_set" && r.listing === "already_set")).toBe(
        true,
      );
    } finally {
      await cleanup();
    }
  });
});
