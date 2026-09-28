#!/usr/bin/env node
// TASKS.md 8.2.e's Check, over the real HTTP stack, same shape
// infra/helios/rustfs-smoke-test.mjs uses (plain Node, built-in fetch, one
// RESULT: line). Drives the whole loop for real:
//
//   1. a viewer buys a voucher through POST /api/checkout (quote -> confirm);
//   2. a Studio user provisions a counter device and pairs it;
//   3. the counter redeems the voucher: lookup -> authorize -> capture;
//   4. GET /api/wallet/vouchers/:id still returns it (state);
//   5. GET /api/:tenantId/studio/redemptions shows the capture against
//      that device;
//   6. the device is revoked (F72: record what was created so it can be
//      cleaned up -- the device row stays as `revoked`, never deleted, the
//      same audit-trail reasoning `studio-devices.controller.ts`'s own
//      revoke route already gives).
//
// Usage:
//   node scripts/check-8.2.e-counter-redemption.mjs
//
// Env (all required unless noted):
//   API_BASE        default http://127.0.0.1:3001 (local). Staging:
//                    http://127.0.0.1:26301, run from the Helios box.
//   VIEWER_EMAIL / VIEWER_PASSWORD   a real signed-in viewer with enough
//                    available points, or release-pending will be tried
//                    once (staging only -- see RELEASE_PENDING below).
//   OWNER_EMAIL / OWNER_PASSWORD     a real Studio owner/staff of the
//                    business that owns LISTING_ID.
//   LISTING_ID       a real, available listing belonging to that business.
//   REVEAL_MODE      "fake" (default) or "live". The counter's lookup/
//                    authorize take the voucher's PLAIN redemption code,
//                    which nothing in the public API surfaces today (a
//                    known, tracked gap -- TASKS.md 4.8.c, requested by B,
//                    not yet done: `GET /api/wallet/vouchers/:id` collapses
//                    every post-purchase state into `activated` and has no
//                    `code` field). Until 4.8.c ships, this script bridges
//                    the one missing link itself:
//                      - "fake" reads `platform.voucher_fake_voucher.code`
//                        directly (DATABASE_URL, LEDGER_MODE=fake -- the
//                        default for a local dev slot, no Go voucher
//                        service running to ask instead);
//                      - "live" signs `POST /internal/v1/vouchers/reveal`
//                        itself (VOUCHER_BASE_URL, VOUCHER_SERVICE_SECRET)
//                        -- the same call `HttpVoucherClient.reveal` makes,
//                        replicated in ~15 lines because this script has no
//                        access to apps/api's own TS module graph. Run
//                        "live" FROM the box the secret already lives on
//                        (`ssh helios-j`, sourcing /opt/yourtal/secrets/app.env
//                        in that same shell) -- it must never be copied
//                        anywhere else.
//   RELEASE_PENDING  "1" to call POST /api/dev/clock/release-pending if the
//                    viewer's available balance is short (staging-only
//                    route; refuses outside dev/staging). Default off.
//
// Prints exactly one line starting "RESULT:" with a JSON summary. Non-zero
// exit on any failure, with the reason on stderr.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Only REVEAL_MODE=fake needs pg at all (REVEAL_MODE=live signs its own
// fetch call, no DB driver) -- loaded lazily inside revealCode() so a live
// run never has to resolve it. This file normally lives at the repo's
// top-level scripts/, which pnpm's strict node_modules does not give a bare
// `import "pg"` access to (only each workspace package's own tree has it)
// -- apps/api already depends on pg, so resolve it from there. On Helios
// the release artifact flattens apps/api to a bare `api/` with its own
// node_modules (infra/HELIOS.md's manifest); running this script copied
// straight into that directory finds pg immediately by the normal upward
// node_modules walk, so try that first and only reach for the
// repo-relative apps/api/package.json otherwise.
async function loadPg() {
  try {
    return (await import("pg")).default;
  } catch {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const apiRequire = createRequire(pathToFileURL(path.join(repoRoot, "apps/api/package.json")));
    return apiRequire("pg");
  }
}

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3001";
const VIEWER_EMAIL = requireEnv("VIEWER_EMAIL");
const VIEWER_PASSWORD = requireEnv("VIEWER_PASSWORD");
const OWNER_EMAIL = requireEnv("OWNER_EMAIL");
const OWNER_PASSWORD = requireEnv("OWNER_PASSWORD");
const LISTING_ID = requireEnv("LISTING_ID");
const LOCATION_ID = requireEnv("LOCATION_ID");
const REVEAL_MODE = process.env.REVEAL_MODE ?? "fake";
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

async function revealCode(voucherId, ownerId) {
  if (REVEAL_MODE === "fake") {
    // Its own short-lived pool, opened and closed around this one query --
    // never held open while the rest of the script runs, so an unrelated
    // later failure's process.exit(1) never has to race a live connection
    // closed (a real crash found running this script on Windows: libuv's
    // "handle->flags & UV_HANDLE_CLOSING" assertion).
    const pg = await loadPg();
    const pool = new pg.Pool({ connectionString: requireEnv("DATABASE_URL") });
    try {
      const { rows } = await pool.query(
        "SELECT code FROM platform.voucher_fake_voucher WHERE id = $1 AND owner_id = $2",
        [voucherId, ownerId],
      );
      if (rows.length === 0) {
        fail(`REVEAL_MODE=fake: no platform.voucher_fake_voucher row for ${voucherId}/${ownerId}`);
      }
      return rows[0].code;
    } finally {
      await pool.end();
    }
  }

  const voucherBase = requireEnv("VOUCHER_BASE_URL");
  const secret = requireEnv("VOUCHER_SERVICE_SECRET");
  const path = "/internal/v1/vouchers/reveal";
  const bodyObj = { voucherId, ownerId };
  const bodyStr = JSON.stringify(bodyObj);
  const at = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(8).toString("hex");
  const bodyDigestB64 = createHash("sha256").update(bodyStr).digest("base64");
  const canonical = [String(at), "api", nonce, "POST", path, bodyDigestB64].join("\n");
  const mac = createHmac("sha256", secret).update(canonical).digest("hex");
  const header = `t=${at},c=api,n=${nonce},v1=${mac}`;

  const response = await fetch(`${voucherBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-YourTal-Service-Signature": header },
    body: bodyStr,
  });
  const json = await response.json();
  if (!response.ok || !json.code) {
    fail(`REVEAL_MODE=live: reveal failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.code;
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

  // 2. A Studio user provisions and pairs a counter device.
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

  // 3. The counter redeems the voucher: lookup -> authorize -> capture.
  const code = await revealCode(voucherId, viewer.userId);

  const deviceHeaders = (idempotencyKey) => ({
    authorization: `Bearer ${deviceCredential}`,
    "content-type": "application/json",
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  });

  const lookup = await fetch(`${API_BASE}/api/counter/lookup`, {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify({ code }),
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
      code,
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

  // 4. The viewer's wallet still lists it.
  const walletVoucher = await req("GET", `/api/wallet/vouchers/${voucherId}`, viewer.token);
  if (walletVoucher.status !== 200) {
    fail(`GET /api/wallet/vouchers/:id failed: ${walletVoucher.status}`);
  }

  // 5. Studio -> Redemptions shows the capture against this device.
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

  // 6. Cleanup: revoke the device this run provisioned (F72).
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
      studioRedemptionFound: true,
      deviceRevoked: revoke.status === 200,
    })}`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.stack : String(error)));
