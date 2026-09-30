#!/usr/bin/env node
// TASKS.md 13.20.d's Check: gifting over the real HTTP stack, in AU and ID,
// against a live voucher service. Per region it registers a sender, a
// recipient, a teen and an adult in the other region; gives the sender one
// voucher on a transferable listing (batch + reserve + activate on the
// voucher service, the state checkout leaves it in); then over the public
// API: gifts to the teen and the other-region adult (refused), gifts to the
// recipient, shows the old code refused at a paired counter, accepts,
// refuses a second gift, and redeems the new voucher at the counter.
// Finally reads the voucher rows, the gift row and both event chains.
//
// Env: API_BASE (default http://127.0.0.1:26481), DATABASE_OWNER_URL,
// VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET. Fixtures (businesses, listings,
// email verification, the teen's birth date) are written by SQL.
// Prints one "RESULT:" line; non-zero exit on the first failure.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = createRequire(pathToFileURL(path.join(repoRoot, "apps/api/package.json")))("pg");

const API = process.env.API_BASE ?? "http://127.0.0.1:26481";
const VOUCHER = need("VOUCHER_BASE_URL");
const SECRET = need("VOUCHER_SERVICE_SECRET");
const db = new pg.Pool({ connectionString: need("DATABASE_OWNER_URL") });
const RUN = randomUUID().slice(0, 8);
const PASSWORD = `gift-check-not-a-secret-${RUN}`;

function need(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}
function fail(message) {
  console.error(`[13.20-check] FAILED: ${message}`);
  process.exit(1);
}
function expect(cond, message) {
  if (!cond) fail(message);
}

async function api(method, route, token, body, extra = {}) {
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
async function voucher(route, body) {
  const payload = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const digest = createHash("sha256").update(payload).digest("base64");
  const mac = createHmac("sha256", SECRET)
    .update([t, "api", nonce, "POST", `/internal/v1${route}`, digest].join("\n"))
    .digest("hex");
  const response = await fetch(`${VOUCHER}/internal/v1${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-yourtal-service-signature": `t=${t},c=api,n=${nonce},v1=${mac}` },
    body: payload,
  });
  const json = await response.json();
  expect(response.ok, `voucher ${route}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

const REGIONS = {
  AU: { locale: "en-AU", timezone: "Australia/Sydney", currency: "AUD", face: 2500, taxKind: "ABN", tax: "12345678901", address: ["NSW", "2000", null] },
  ID: { locale: "id-ID", timezone: "Asia/Jakarta", currency: "IDR", face: 50000, taxKind: "NPWP", tax: "1234567890123456", address: [null, null, "Jakarta"] },
};

// The first account registers over HTTP; the rest reuse its password hash
// by SQL, because registration allows 5 per address per hour.
let template;
async function person(region, role) {
  const r = REGIONS[region];
  const email = `gift-check-${role}-${region.toLowerCase()}-${RUN}@example.test`;
  const displayName = `Gift ${role} ${region}`;
  let userId;
  if (template === undefined) {
    const reg = await api("POST", "/api/auth/register", undefined, {
      email, password: PASSWORD, region, locale: r.locale, displayName,
      dateOfBirth: "1990-01-01", timezone: r.timezone,
    });
    expect(reg.status < 400, `register ${email}: ${reg.status} ${JSON.stringify(reg.json)}`);
    userId = reg.json.userId;
    const { rows } = await db.query(`SELECT secret_hash FROM identity.credential WHERE user_id = $1`, [userId]);
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
  await db.query(`UPDATE identity.credential SET verified_at = now() WHERE identifier = $1`, [email]);
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

async function shop(region, owner) {
  const r = REGIONS[region];
  const [business, location, listing] = [randomUUID(), randomUUID(), randomUUID()];
  await db.query(
    `INSERT INTO business.business_accounts (id, legal_name, display_name, tax_id_kind, tax_id_value,
       address_state, address_postcode, address_city, roles, region, currency, handle)
     VALUES ($1, $2, $2, $3, $4, $8, $9, $10, '["redeemer"]', $5, $6, $7)`,
    [business, `Gift Check ${region} ${RUN}`, r.taxKind, r.tax, region, r.currency, `gift-check-${region.toLowerCase()}-${RUN}`, ...r.address],
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
  await db.query(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`, [listing, location]);
  const batch = await voucher("/batches", {
    listingId: listing, merchantId: business, currency: r.currency, faceValueMinor: r.face,
    quantity: 2, partialRedemptionPolicy: "single_use_forfeit", requestedBy: `check-${RUN}-a`,
  });
  await voucher("/batches/approve", { batchId: batch.batchId, approvedBy: `check-${RUN}-b` });
  return { business, location, listing };
}

async function counter(owner, shopIds) {
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const provision = await api("POST", `/api/${shopIds.business}/studio/devices`, owner.token, {
    locationId: shopIds.location, label: `Gift check ${RUN}`, pin,
  });
  expect(provision.status === 201, `provision: ${provision.status} ${JSON.stringify(provision.json)}`);
  const paired = await api("POST", "/api/devices/pair", undefined, { pairingCode: provision.json.pairingCode });
  expect(paired.status < 300, `pair: ${paired.status}`);
  const auth = { authorization: `Bearer ${paired.json.credential}` };
  return {
    lookup: (code) => api("POST", "/api/counter/lookup", undefined, { code }, auth),
    redeem: async (code) => {
      const found = await api("POST", "/api/counter/lookup", undefined, { code }, auth);
      expect(found.status === 201, `lookup of the new code: ${found.status} ${JSON.stringify(found.json)}`);
      const held = await api("POST", "/api/counter/authorize", undefined, {
        code, amountMinor: found.json.remainingValueMinor, currency: found.json.currency,
        orderRef: `gift-${RUN}`, orderTotalMinor: found.json.remainingValueMinor,
      }, auth);
      expect(held.status < 300, `authorize: ${held.status} ${JSON.stringify(held.json)}`);
      const captured = await api("POST", "/api/counter/capture", undefined, { authorizationId: held.json.authorizationId }, auth);
      expect(captured.status < 300, `capture: ${captured.status} ${JSON.stringify(captured.json)}`);
      return captured.json;
    },
  };
}

async function events(voucherId) {
  const { rows } = await db.query(`SELECT event_type, detail FROM voucher.event WHERE voucher_id = $1 ORDER BY seq`, [voucherId]);
  return rows;
}

async function region(code, other) {
  const [sender, recipient, teen, owner, abroad] = [
    await person(code, "sender"), await person(code, "recipient"), await person(code, "teen"),
    await person(code, "owner"), await person(other, "abroad"),
  ];
  const ids = await shop(code, owner);
  const saga = `gift-check-${randomUUID()}`;
  const reserved = await voucher("/reservations", { listingId: ids.listing, sagaId: saga });
  await voucher("/reservations/activate", { sagaId: saga, ownerId: sender.id });
  const oldId = reserved.voucherId;
  const { code: oldCode } = await voucher("/vouchers/reveal", { voucherId: oldId, ownerId: sender.id });

  const listed = await api("GET", `/api/wallet/vouchers/${oldId}`, sender.token);
  expect(listed.json.giftable === true, `the sender's voucher is not giftable: ${JSON.stringify(listed.json)}`);

  const gift = (to) => api("POST", `/api/wallet/vouchers/${oldId}/gift`, sender.token, { recipientEmail: to });
  const toTeen = await gift(teen.email);
  expect(toTeen.status === 409 && toTeen.json.code === "gift_recipient_ineligible", `teen recipient: ${toTeen.status} ${JSON.stringify(toTeen.json)}`);
  const toAbroad = await gift(abroad.email);
  expect(toAbroad.status === 409 && toAbroad.json.code === "gift_recipient_ineligible", `cross-region recipient: ${toAbroad.status} ${JSON.stringify(toAbroad.json)}`);
  const teenSends = await api("POST", `/api/wallet/vouchers/${oldId}/gift`, teen.token, { recipientEmail: recipient.email });
  expect(teenSends.status === 403 || teenSends.status === 404, `a teen sending: ${teenSends.status}`);

  const sent = await gift(recipient.email);
  expect(sent.status === 201 && sent.json.status === "pending", `gift: ${sent.status} ${JSON.stringify(sent.json)}`);
  const giftId = sent.json.giftId;

  const till = await counter(owner, ids);
  const oldAtTill = await till.lookup(oldCode);
  expect(oldAtTill.status >= 400, `the old code still works at the counter: ${oldAtTill.status}`);
  const oldQr = await api("GET", `/api/wallet/vouchers/${oldId}/qr`, sender.token);
  expect(oldQr.status === 409, `the old voucher still shows a QR: ${oldQr.status}`);

  const teenAccepts = await api("POST", `/api/wallet/gifts/${giftId}/accept`, teen.token);
  expect(teenAccepts.status === 403, `a teen accepting: ${teenAccepts.status}`);
  const inbox = await api("GET", "/api/wallet/gifts", recipient.token);
  const received = inbox.json.gifts?.find((g) => g.giftId === giftId);
  expect(received?.direction === "received" && received.senderDisplayName === `Gift sender ${code}`, `recipient's gifts: ${JSON.stringify(inbox.json)}`);
  const accepted = await api("POST", `/api/wallet/gifts/${giftId}/accept`, recipient.token);
  expect(accepted.status === 200 && accepted.json.status === "accepted", `accept: ${accepted.status} ${JSON.stringify(accepted.json)}`);
  const newId = accepted.json.voucherId;

  const again = await api("POST", `/api/wallet/vouchers/${newId}/gift`, recipient.token, { recipientEmail: sender.email });
  expect(again.status === 409 && again.json.code === "gift_already_gifted", `second gift: ${again.status} ${JSON.stringify(again.json)}`);
  const regift = await gift(recipient.email);
  expect(regift.status === 201 && regift.json.giftId === giftId, `replaying the same gift must return it: ${regift.status}`);

  const qr = await api("GET", `/api/wallet/vouchers/${newId}/qr`, recipient.token);
  expect(qr.status === 200, `new QR: ${qr.status}`);
  const capture = await till.redeem(qr.json.token);
  const after = await api("GET", `/api/wallet/vouchers/${newId}`, recipient.token);
  expect(after.json.status === "redeemed", `the new voucher is ${after.json.status}, not redeemed`);
  const senderView = await api("GET", `/api/wallet/vouchers/${oldId}`, sender.token);
  expect(senderView.json.status === "transferred", `the sender sees ${senderView.json.status}, not transferred`);

  const { rows } = await db.query(
    `SELECT v.id, v.state, v.void_reason, v.owner_id, v.region, v.remaining_value_minor FROM voucher.vouchers v WHERE v.id = ANY($1)`,
    [[oldId, newId]],
  );
  const oldRow = rows.find((r) => r.id === oldId);
  const newRow = rows.find((r) => r.id === newId);
  expect(oldRow.state === "voided" && oldRow.void_reason === "transfer" && oldRow.owner_id === sender.id, `old row ${JSON.stringify(oldRow)}`);
  expect(newRow.state === "redeemed" && newRow.owner_id === recipient.id && newRow.region === code, `new row ${JSON.stringify(newRow)}`);
  const { rows: [giftRow] } = await db.query(`SELECT * FROM voucher.gift WHERE id = $1`, [giftId]);
  expect(giftRow.state === "accepted" && giftRow.source_voucher_id === oldId && giftRow.voucher_id === newId && giftRow.region === code, `gift row ${JSON.stringify(giftRow)}`);
  const oldChain = (await events(oldId)).map((e) => e.event_type);
  const newChain = await events(newId);
  expect(oldChain.at(-1) === "transferred", `old chain ${oldChain}`);
  expect(newChain[0].event_type === "minted" && newChain[0].detail.remint_of === oldId && newChain[0].detail.gift_id === giftId, `new chain head ${JSON.stringify(newChain[0])}`);
  expect(newChain.map((e) => e.event_type).join(",") === "minted,allocated,activated,authorized,captured", `new chain ${newChain.map((e) => e.event_type)}`);
  return { region: code, giftId, oldVoucher: oldId, newVoucher: newId, captureId: capture.captureId, oldChain, newChain: newChain.map((e) => e.event_type) };
}

try {
  const au = await region("AU", "ID");
  const id = await region("ID", "AU");
  console.log(`RESULT:${JSON.stringify({ ok: true, run: RUN, au, id })}`);
} finally {
  await db.end();
}
