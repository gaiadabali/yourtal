// Shared fixtures for the HTTP Checks against a live voucher service
// (check-13.20-gift.mjs, check-13.22-auction.mjs): signed voucher-service
// calls, accounts, a shop with a transferable listing, a paired counter.
// Env: API_BASE, DATABASE_OWNER_URL, VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = createRequire(pathToFileURL(path.join(repoRoot, "apps/api/package.json")))("pg");

export const API = process.env.API_BASE ?? "http://127.0.0.1:26481";
const VOUCHER = need("VOUCHER_BASE_URL");
const SECRET = need("VOUCHER_SERVICE_SECRET");
export const db = new pg.Pool({ connectionString: need("DATABASE_OWNER_URL") });
export const RUN = randomUUID().slice(0, 8);
const PASSWORD = `check-not-a-secret-${RUN}`;

export function need(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}
export function fail(message) {
  console.error(`[check] FAILED: ${message}`);
  process.exit(1);
}
export function expect(cond, message) {
  if (!cond) fail(message);
}

export async function api(method, route, token, body, extra = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : {} };
}

// services/voucher/internal/serviceauth, as HttpVoucherClient signs it.
export async function voucher(route, body) {
  const payload = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const digest = createHash("sha256").update(payload).digest("base64");
  const mac = createHmac("sha256", SECRET)
    .update([t, "api", nonce, "POST", `/internal/v1${route}`, digest].join("\n"))
    .digest("hex");
  const response = await fetch(`${VOUCHER}/internal/v1${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yourtal-service-signature": `t=${t},c=api,n=${nonce},v1=${mac}`,
    },
    body: payload,
  });
  const json = await response.json();
  expect(response.ok, `voucher ${route}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

const REGIONS = {
  AU: {
    locale: "en-AU",
    timezone: "Australia/Sydney",
    currency: "AUD",
    face: 2500,
    taxKind: "ABN",
    tax: "12345678901",
    address: ["NSW", "2000", null],
  },
  ID: {
    locale: "id-ID",
    timezone: "Asia/Jakarta",
    currency: "IDR",
    face: 50000,
    taxKind: "NPWP",
    tax: "1234567890123456",
    address: [null, null, "Jakarta"],
  },
};

// The first account registers over HTTP; the rest reuse its password hash
// by SQL, because registration allows 5 per address per hour.
let template;
export async function person(region, role) {
  const r = REGIONS[region];
  const email = `check-${role}-${region.toLowerCase()}-${RUN}@example.test`;
  const displayName = `Gift ${role} ${region}`;
  let userId;
  if (template === undefined) {
    const reg = await api("POST", "/api/auth/register", undefined, {
      email,
      password: PASSWORD,
      region,
      locale: r.locale,
      displayName,
      dateOfBirth: "1990-01-01",
      timezone: r.timezone,
    });
    expect(reg.status < 400, `register ${email}: ${reg.status} ${JSON.stringify(reg.json)}`);
    userId = reg.json.userId;
    const { rows } = await db.query(
      `SELECT secret_hash FROM identity.credential WHERE user_id = $1`,
      [userId],
    );
    template = rows[0].secret_hash;
  } else {
    userId = randomUUID();
    await db.query(
      `INSERT INTO identity.credential (user_id, kind, identifier, secret_hash) VALUES ($1, 'password', $2, $3)`,
      [userId, email, template],
    );
    await db.query(
      `INSERT INTO identity.user_profile (user_id, region, display_locale, display_name, date_of_birth, timezone)
       VALUES ($1, $2, $3, $4, '1990-01-01', $5)`,
      [userId, region, r.locale, displayName, r.timezone],
    );
  }
  await db.query(`UPDATE identity.credential SET verified_at = now() WHERE identifier = $1`, [
    email,
  ]);
  if (role === "teen") {
    await db.query(
      `UPDATE identity.user_profile SET date_of_birth = (now() - interval '15 years')::date,
              parent_consent_status = 'granted' WHERE user_id = $1`,
      [userId],
    );
  }
  const login = await api("POST", "/api/auth/login", undefined, { email, password: PASSWORD });
  expect(login.status === 201, `login ${email}: ${login.status} ${JSON.stringify(login.json)}`);
  return { email, id: userId, token: login.json.token };
}

export async function shop(region, owner) {
  const r = REGIONS[region];
  const [business, location, listing] = [randomUUID(), randomUUID(), randomUUID()];
  await db.query(
    `INSERT INTO business.business_accounts (id, legal_name, display_name, tax_id_kind, tax_id_value,
       address_state, address_postcode, address_city, roles, region, currency, handle)
     VALUES ($1, $2, $2, $3, $4, $8, $9, $10, '["redeemer"]', $5, $6, $7)`,
    [
      business,
      `Gift Check ${region} ${RUN}`,
      r.taxKind,
      r.tax,
      region,
      r.currency,
      `check-${region.toLowerCase()}-${RUN}`,
      ...r.address,
    ],
  );
  await db.query(
    `INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at)
     VALUES ($1, $2, 'owner', $2, now())`,
    [business, owner.id],
  );
  await db.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district) VALUES ($1, $2, 'Gift Check Store', '1 Test St', 'Test')`,
    [location, business],
  );
  await db.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
       transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status, currency,
       region, audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Gift Check Merchant', 'Gift Check Voucher', '13.20 check', 'food-and-drink',
       $3, $4, 500, 5, 5, true, 'single_use_forfeit', NULL, now() + interval '1 year', 'available',
       $5, $6, 'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/p.jpg', 'both', 'single_use')`,
    [listing, business, r.face, Math.floor(r.face * 0.6), r.currency, region],
  );
  await db.query(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`, [
    listing,
    location,
  ]);
  const batch = await voucher("/batches", {
    listingId: listing,
    merchantId: business,
    currency: r.currency,
    faceValueMinor: r.face,
    quantity: 2,
    partialRedemptionPolicy: "single_use_forfeit",
    requestedBy: `check-${RUN}-a`,
  });
  await voucher("/batches/approve", { batchId: batch.batchId, approvedBy: `check-${RUN}-b` });
  return { business, location, listing };
}

export async function counter(owner, shopIds) {
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const provision = await api("POST", `/api/${shopIds.business}/studio/devices`, owner.token, {
    locationId: shopIds.location,
    label: `Check ${RUN}`,
    pin,
  });
  expect(
    provision.status === 201,
    `provision: ${provision.status} ${JSON.stringify(provision.json)}`,
  );
  const paired = await api("POST", "/api/devices/pair", undefined, {
    pairingCode: provision.json.pairingCode,
  });
  expect(paired.status < 300, `pair: ${paired.status}`);
  const auth = { authorization: `Bearer ${paired.json.credential}` };
  return {
    lookup: (code) => api("POST", "/api/counter/lookup", undefined, { code }, auth),
    redeem: async (code) => {
      const found = await api("POST", "/api/counter/lookup", undefined, { code }, auth);
      expect(
        found.status === 201,
        `lookup of the new code: ${found.status} ${JSON.stringify(found.json)}`,
      );
      const held = await api(
        "POST",
        "/api/counter/authorize",
        undefined,
        {
          code,
          amountMinor: found.json.remainingValueMinor,
          currency: found.json.currency,
          orderRef: `gift-${RUN}`,
          orderTotalMinor: found.json.remainingValueMinor,
        },
        auth,
      );
      expect(held.status < 300, `authorize: ${held.status} ${JSON.stringify(held.json)}`);
      const captured = await api(
        "POST",
        "/api/counter/capture",
        undefined,
        { authorizationId: held.json.authorizationId },
        auth,
      );
      expect(captured.status < 300, `capture: ${captured.status} ${JSON.stringify(captured.json)}`);
      return captured.json;
    },
  };
}

export async function events(voucherId) {
  const { rows } = await db.query(
    `SELECT event_type, detail FROM voucher.event WHERE voucher_id = $1 ORDER BY seq`,
    [voucherId],
  );
  return rows;
}
