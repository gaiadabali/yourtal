#!/usr/bin/env node
// Local-only fixture setup for check-8.2.e-counter-redemption.mjs. NOT part
// of the Check itself -- staging already has real demo accounts and a real
// listing (see that script's own header); this exists only so 8.2.e can be
// verified against a slot's own throwaway dev database first, per TASKS.md's
// "Run it locally against your own slot first."
//
// Registers a fresh viewer and a fresh business owner through the real
// POST /api/auth/register (so their credentials are real), then inserts a
// business/location/listing and grants the viewer enough points directly by
// SQL -- the same shape packages/db/src/seed/staging.ts's own demo listing
// and apps/api/src/shared/ledger-client/fake/fake-ledger-rewards.ts's own
// grant insert already use. Prints the env line to feed the Check.
//
// Usage: node scripts/setup-local-8.2.e-check.mjs (from the repo root).
// Env: API_BASE (default http://127.0.0.1:3001), DATABASE_URL (required).

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same resolution trick check-8.2.e-counter-redemption.mjs's own header
// comment explains: pg lives in apps/api's own node_modules, not this
// top-level scripts/ directory's.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(pathToFileURL(path.join(repoRoot, "apps/api/package.json")));
const pg = apiRequire("pg");

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function req(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const runId = randomUUID().slice(0, 8);
  const password = `local-check-not-a-real-secret-${runId}`;

  const viewerEmail = `check-8-2-e-viewer-${runId}@example.test`;
  const viewerRegister = await req("POST", "/api/auth/register", {
    email: viewerEmail,
    password,
    region: "AU",
    locale: "en-AU",
    displayName: "8.2.e Check Viewer",
    dateOfBirth: "1990-01-01",
    timezone: "Australia/Sydney",
  });
  if (viewerRegister.status >= 400) {
    console.error(
      `viewer register failed: ${viewerRegister.status} ${JSON.stringify(viewerRegister.json)}`,
    );
    process.exit(1);
  }
  const viewerId = viewerRegister.json.userId;

  const ownerEmail = `check-8-2-e-owner-${runId}@example.test`;
  const ownerRegister = await req("POST", "/api/auth/register", {
    email: ownerEmail,
    password,
    region: "AU",
    locale: "en-AU",
    displayName: "8.2.e Check Owner",
    dateOfBirth: "1990-01-01",
    timezone: "Australia/Sydney",
  });
  if (ownerRegister.status >= 400) {
    console.error(
      `owner register failed: ${ownerRegister.status} ${JSON.stringify(ownerRegister.json)}`,
    );
    process.exit(1);
  }
  const ownerId = ownerRegister.json.userId;

  const businessId = randomUUID();
  const locationId = randomUUID();
  const listingId = randomUUID();
  // checkoutQuote re-derives the price from face/settlement value at the
  // CURRENT backing rate rather than trusting this stored column (found
  // running this script: it quoted 1000, not the 500 written below) -- so
  // this grants generously rather than trying to match it exactly.
  const priceInPoints = 500;
  const grantPoints = 5000;

  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, tax_id_kind, tax_id_value, address_state, address_postcode,
        address_city, roles, region, currency, handle)
     VALUES ($1, $2, $3, 'ABN', '12345678901', 'NSW', '2000', NULL, $4, 'AU', 'AUD', $5)`,
    [
      businessId,
      `8.2.e Check Business ${runId}`,
      `8.2.e Check Business ${runId}`,
      JSON.stringify(["redeemer"]),
      `check-8-2-e-${runId}`,
    ],
  );
  await pool.query(
    `INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
     VALUES ($1, $2, 'owner', $2, now())`,
    [businessId, ownerId],
  );
  await pool.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
     VALUES ($1, $2, '8.2.e Check Store', '1 Test St', 'Test District')`,
    [locationId, businessId],
  );
  const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  await pool.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category,
        face_value_minor, settlement_value_minor, price_in_points,
        stock_remaining, stock_total, transferable, partial_redemption_policy,
        minimum_spend_minor, expires_at, status, currency, region, audience,
        content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, '8.2.e Check Merchant', '8.2.e Check Listing',
             'seeded for check-8.2.e-counter-redemption.mjs', 'food-and-drink',
             4500, 3000, $3, 10, 10, false, 'single_use_forfeit',
             NULL, $4, 'available', 'AUD', 'AU', 'all_ages',
             'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')`,
    [listingId, businessId, priceInPoints, farFuture],
  );
  await pool.query(
    `INSERT INTO platform.ledger_fake_grant
       (id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key, campaign_id)
     VALUES ($1, 'goodwill', $2, 'AU', $3, now(), now(), $4, NULL)`,
    [randomUUID(), viewerId, grantPoints, `check-8-2-e-fund-${runId}`],
  );

  await pool.end();

  console.log("Fixtures created. Run the Check with:");
  console.log("");
  console.log(
    [
      `VIEWER_EMAIL='${viewerEmail}'`,
      `VIEWER_PASSWORD='${password}'`,
      `OWNER_EMAIL='${ownerEmail}'`,
      `OWNER_PASSWORD='${password}'`,
      `LISTING_ID='${listingId}'`,
      `LOCATION_ID='${locationId}'`,
      `REVEAL_MODE=fake`,
      `DATABASE_URL='${DATABASE_URL}'`,
      `API_BASE='${API_BASE}'`,
      `pnpm --filter @yourtal/api exec node ../../scripts/check-8.2.e-counter-redemption.mjs`,
    ].join(" \\\n  "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
