#!/usr/bin/env node
// TASKS.md 8.2.e's Check, over the real HTTP stack, same shape
// infra/helios/rustfs-smoke-test.mjs uses (plain Node, built-in fetch, one
// RESULT: line). Drives the whole loop for real, the way an actual viewer
// and an actual cashier do it -- no voucher-service secret, no direct DB
// read:
//
//   1. a viewer buys a voucher through POST /api/checkout (quote -> confirm);
//   2. the SAME viewer fetches GET /api/wallet/vouchers/:id/qr (4.5.b/4.8.a)
//      -- the actual QR a wallet screen shows at a till;
//   3. a Studio user provisions a counter device and pairs it;
//   4. the counter redeems the voucher with that QR token: lookup ->
//      authorize -> capture (8.2.a, widened by this same ticket -- see
//      below);
//   5. GET /api/wallet/vouchers/:id shows it REDEEMED (status, TASKS.md
//      4.8.c -- the old `state` field still just says "activated" either
//      way, so it never distinguished a captured voucher from an untouched
//      one, and this Check now fails if `status` is not "redeemed");
//   6. GET /api/:tenantId/studio/redemptions shows the capture against
//      that device;
//   7. the device is revoked (F72: record what was created so it can be
//      cleaned up -- the device row stays as `revoked`, never deleted, the
//      same audit-trail reasoning `studio-devices.controller.ts`'s own
//      revoke route already gives).
//
// Found running this Check the first time: the counter never accepted a QR
// token at all, only a typed code -- `GET .../qr` mints one (4.5.b/4.8.a)
// but nothing on the redemption side could verify it, a real 8.2.a gap.
// Fixed in the same commit as this rewrite: services/voucher's
// lookupAsDevice/authorizeAsDevice (device_routes.go) now try a plain code
// first, then a signed QR token (qrtoken.Verify) as a fallback -- mirrored
// in the fake client for local parity, and covered by a new case in
// voucher-client.contract.spec.ts (run against both the fake AND, via
// `pnpm test:voucher-live`, a real Go service). This script no longer needs
// any REVEAL_MODE, VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET or DATABASE_URL
// -- it proves the actual user path, not a bridge around a gap.
//
// Usage:
//   node scripts/check-8.2.e-counter-redemption.mjs
//
// Env (all required unless noted):
//   API_BASE        default http://127.0.0.1:3001 (local). Staging:
//                    http://127.0.0.1:26301, run from the Helios box, or
//                    https://yourtal.gaiada.com directly (no jump needed
//                    for plain HTTP -- only :22/:8443 are IP-allowlisted).
//   VIEWER_EMAIL / VIEWER_PASSWORD   a real signed-in viewer with enough
//                    available points, or release-pending will be tried
//                    once (staging only -- see RELEASE_PENDING below).
//   OWNER_EMAIL / OWNER_PASSWORD     a real Studio owner/staff of the
//                    business that owns LISTING_ID.
//   LISTING_ID       a real, available listing belonging to that business,
//                    affordable at ITS CURRENT LIVE QUOTE -- checkout
//                    re-prices from the listing's face/settlement value at
//                    today's backing rate, not the stored priceInPoints
//                    column (found running this script: a listing "priced"
//                    at 500 quoted 1000).
//   LOCATION_ID      a real location belonging to that same business.
//   RELEASE_PENDING  "1" to call POST /api/dev/clock/release-pending if the
//                    viewer's available balance is short (staging-only
//                    route; refuses outside dev/staging). Default off --
//                    and it only helps if the shortfall is actually
//                    PENDING, not just below the listing's price.
//
// Prints exactly one line starting "RESULT:" with a JSON summary. Non-zero
// exit on any failure, with the reason on stderr.

import { randomUUID } from "node:crypto";

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const VIEWER_EMAIL = requireEnv("VIEWER_EMAIL");
const VIEWER_PASSWORD = requireEnv("VIEWER_PASSWORD");
const OWNER_EMAIL = requireEnv("OWNER_EMAIL");
const OWNER_PASSWORD = requireEnv("OWNER_PASSWORD");
const LISTING_ID = requireEnv("LISTING_ID");
const LOCATION_ID = requireEnv("LOCATION_ID");
const RELEASE_PENDING = process.env.RELEASE_PENDING === "1";
const RUN_ID = randomUUID().slice(0, 8);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} env var is required`);
  return value;
}

function fail(message) {
  console.error(`[8.2.e-check] FAILED: ${message}`);
  process.exit(1);
}

async function req(method, path, token, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      // Only when a body is actually being sent -- an empty DELETE with
      // content-type: application/json set anyway is refused 400 ("Body
      // cannot be empty..."), found running this script against
      // DELETE .../studio/devices/:id.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

async function login(email, password) {
  let login;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    login = await req("POST", "/api/auth/login", undefined, { email, password });
    if (login.status === 201) break;
    if (attempt === 15) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (login.status !== 201 || !login.json.token) {
    fail(`login (${email}) failed: ${login.status} ${JSON.stringify(login.json)}`);
  }
  return { token: login.json.token, userId: login.json.userId };
}

async function main() {
  const created = { runId: RUN_ID };

  // 1. The viewer buys the voucher.
  const viewer = await login(VIEWER_EMAIL, VIEWER_PASSWORD);

  const quote = await req("POST", "/api/checkout/quote", viewer.token, { listingId: LISTING_ID });
  if (quote.status !== 201 || !quote.json.checkoutId) {
    fail(`checkout quote failed: ${quote.status} ${JSON.stringify(quote.json)}`);
  }
  const { checkoutId, pricePoints } = quote.json;
  created.checkoutId = checkoutId;

  const wallet = await req("GET", "/api/wallet", viewer.token);
  if (wallet.status !== 200) fail(`GET /api/wallet failed: ${wallet.status}`);
  if (wallet.json.availablePoints < pricePoints) {
    if (!RELEASE_PENDING) {
      fail(
        `${VIEWER_EMAIL} has ${wallet.json.availablePoints} available, needs ${pricePoints}. ` +
          `Set RELEASE_PENDING=1 to try /api/dev/clock/release-pending (staging only), or use a ` +
          `viewer/listing pair that already affords it.`,
      );
    }
    const released = await req("POST", "/api/dev/clock/release-pending", viewer.token, {});
    if (released.status !== 200 && released.status !== 201) {
      fail(`release-pending failed: ${released.status} ${JSON.stringify(released.json)}`);
    }
    const walletAfter = await req("GET", "/api/wallet", viewer.token);
    if (walletAfter.json.availablePoints < pricePoints) {
      fail(
        `still short after release-pending: ${walletAfter.json.availablePoints} available, needs ${pricePoints}`,
      );
    }
  }

  const confirm = await req("POST", "/api/checkout", viewer.token, { checkoutId });
  if (confirm.status !== 200 || !confirm.json.voucherId) {
    fail(`checkout confirm failed: ${confirm.status} ${JSON.stringify(confirm.json)}`);
  }
  const voucherId = confirm.json.voucherId;
  created.voucherId = voucherId;

  // 2. The SAME viewer fetches the QR a wallet screen would show at a till
  // (4.5.b/4.8.a) -- the actual credential the counter now accepts (see
  // this file's own header for the 8.2.a gap this ticket closed).
  const qr = await req("GET", `/api/wallet/vouchers/${voucherId}/qr`, viewer.token);
  if (qr.status !== 200 || !qr.json.token) {
    fail(`GET .../qr failed: ${qr.status} ${JSON.stringify(qr.json)}`);
  }
  const qrToken = qr.json.token;

  // 3. A Studio user provisions and pairs a counter device.
  const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const businesses = await req("GET", "/api/me/businesses", owner.token);
  const membership = businesses.json.find?.((m) => m.business?.id !== undefined);
  if (businesses.status !== 200 || membership === undefined) {
    fail(
      `GET /api/me/businesses returned no memberships: ${businesses.status} ${JSON.stringify(businesses.json)}`,
    );
  }
  const businessId = membership.business.id;

  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const provision = await req("POST", `/api/${businessId}/studio/devices`, owner.token, {
    locationId: LOCATION_ID,
    label: `8.2.e Check ${RUN_ID}`,
    pin,
  });
  if (provision.status !== 201 || !provision.json.device?.id || !provision.json.pairingCode) {
    fail(`device provision failed: ${provision.status} ${JSON.stringify(provision.json)}`);
  }
  const deviceId = provision.json.device.id;
  created.deviceId = deviceId;

  const paired = await req("POST", "/api/devices/pair", undefined, {
    pairingCode: provision.json.pairingCode,
  });
  if (paired.status !== 200 && paired.status !== 201) {
    fail(`device pair failed: ${paired.status} ${JSON.stringify(paired.json)}`);
  }
  const deviceCredential = paired.json.credential;

  // 4. The counter redeems the voucher with the QR token: lookup ->
  // authorize -> capture. Same `code` field the typed-code path always
  // used -- device_routes.go's resolveDeviceVoucher (8.2.a, this ticket)
  // tries a plain code first, then a signed QR token, so no request-shape
  // change was needed here.
  const deviceHeaders = (idempotencyKey) => ({
    authorization: `Bearer ${deviceCredential}`,
    "content-type": "application/json",
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  });

  const lookup = await fetch(`${API_BASE}/api/counter/lookup`, {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ code: qrToken }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  // 201, not 200: counter.controller.ts's routes carry no @HttpCode
  // override, so Nest's own @Post default applies -- a pre-existing,
  // already-flagged mismatch with route-registry.c-counter.ts's declared
  // 200 (same shape 8.4.a's own report flagged for this module, not fixed
  // there either -- out of scope for this Check).
  if (lookup.status !== 201)
    fail(`counter lookup failed: ${lookup.status} ${JSON.stringify(lookup.json)}`);

  const authorize = await fetch(`${API_BASE}/api/counter/authorize`, {
    method: "POST",
    headers: deviceHeaders(randomUUID()),
    body: JSON.stringify({
      code: qrToken,
      // Explicit, not omitted: the fake and live voucher clients default a
      // missing amountMinor differently (fake -> 0, live -> the voucher's
      // full remaining value), and this Check redeems the full value in
      // both modes.
      amountMinor: lookup.json.remainingValueMinor,
      currency: lookup.json.currency,
      orderRef: `8.2.e-check-${RUN_ID}`,
      orderTotalMinor: lookup.json.remainingValueMinor,
    }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  if (authorize.status !== 201 && authorize.status !== 200) {
    fail(`counter authorize failed: ${authorize.status} ${JSON.stringify(authorize.json)}`);
  }
  created.authorizationId = authorize.json.authorizationId;

  const capture = await fetch(`${API_BASE}/api/counter/capture`, {
    method: "POST",
    headers: deviceHeaders(randomUUID()),
    body: JSON.stringify({ authorizationId: authorize.json.authorizationId }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  if (capture.status !== 201 && capture.status !== 200) {
    fail(`counter capture failed: ${capture.status} ${JSON.stringify(capture.json)}`);
  }
  created.captureId = capture.json.captureId;

  // 5. The viewer's wallet shows it as REDEEMED, not merely present.
  // TASKS.md 4.8.c (found running this Check on staging): the wallet read
  // used to carry only the reserved/activated/released collapse, so a
  // captured voucher and a never-touched one were indistinguishable here --
  // a user would see a spent voucher as still usable. `status` is the new,
  // real-state field (`wallet-mapping.ts`'s `publicVoucherStatusOf`); a
  // full capture (this Check always sends the full remaining value as
  // amountMinor above) must show `redeemed`, never the old `state` field,
  // which still just says "activated" either way and is not what a fix
  // here can be verified against.
  const walletVoucher = await req("GET", `/api/wallet/vouchers/${voucherId}`, viewer.token);
  if (walletVoucher.status !== 200) {
    fail(`GET /api/wallet/vouchers/:id failed: ${walletVoucher.status}`);
  }
  if (walletVoucher.json.status !== "redeemed") {
    fail(
      `wallet still shows voucher ${voucherId} as status=${JSON.stringify(walletVoucher.json.status)} ` +
        `(state=${JSON.stringify(walletVoucher.json.state)}) after a full capture -- expected "redeemed" ` +
        `(TASKS.md 4.8.c). Full response: ${JSON.stringify(walletVoucher.json)}`,
    );
  }
  if (walletVoucher.json.remainingValueMinor !== 0) {
    fail(
      `wallet shows remainingValueMinor=${JSON.stringify(walletVoucher.json.remainingValueMinor)} ` +
        `for a fully-captured voucher, expected 0`,
    );
  }

  // 6. Studio -> Redemptions shows the capture against this device.
  const redemptions = await req(
    "GET",
    `/api/${businessId}/studio/redemptions?deviceId=${deviceId}`,
    owner.token,
  );
  if (redemptions.status !== 200) {
    fail(`GET .../studio/redemptions failed: ${redemptions.status}`);
  }
  const found = redemptions.json.entries?.find(
    (entry) => entry.captureId === capture.json.captureId,
  );
  if (found === undefined) {
    fail(
      `capture ${capture.json.captureId} not found in .../studio/redemptions for device ${deviceId}: ` +
        JSON.stringify(redemptions.json),
    );
  }

  // 7. Cleanup: revoke the device this run provisioned (F72).
  const revoke = await req("DELETE", `/api/${businessId}/studio/devices/${deviceId}`, owner.token);
  if (revoke.status !== 200) {
    console.error(
      `[8.2.e-check] WARNING: device ${deviceId} was not revoked (${revoke.status} ${JSON.stringify(revoke.json)}) -- clean up by hand`,
    );
  }

  console.log(
    `RESULT:${JSON.stringify({
      ok: true,
      businessId,
      deviceId,
      voucherId,
      checkoutId,
      authorizationId: created.authorizationId,
      captureId: created.captureId,
      walletVoucherState: walletVoucher.json.state,
      walletVoucherStatus: walletVoucher.json.status,
      studioRedemptionFound: true,
      deviceRevoked: revoke.status === 200,
    })}`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.stack : String(error)));
