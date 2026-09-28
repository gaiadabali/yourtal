/**
 * TEMPORARY, uncommitted driver for Phase 8 C's manual 8.3.d/8.4.b checks.
 * Drives real HTTP calls against locally running services (apps/api,
 * services/voucher, apps/worker) plus the real @yourtal/sdk-merchant client
 * and webhook verifier. Deleted before this session's work is committed.
 */
import { randomUUID, createHash, createHmac } from "node:crypto";
import { createMerchantClient } from "../src/client";

const API = "http://127.0.0.1:26472";
const VOUCHER_SERVICE_SECRET = "local-only-voucher-service-secret-not-real";
const VOUCHER_BASE = "http://127.0.0.1:26474";
const LEDGER_SERVICE_SECRET = "local-only-ledger-service-secret-not-real";
const LEDGER_BASE = "http://127.0.0.1:26473";

function idem(): string {
  return randomUUID();
}

async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (method === "POST") headers["idempotency-key"] = idem();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function signServiceRequest(secret: string, path: string, body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const bodyDigest = createHash("sha256").update(body).digest("base64");
  const mac = createHmac("sha256", secret)
    .update([String(t), "api", nonce, "POST", path, bodyDigest].join("\n"))
    .digest("hex");
  return `t=${t},c=api,n=${nonce},v1=${mac}`;
}

async function revealCode(voucherId: string, ownerId: string): Promise<string> {
  const path = "/internal/v1/vouchers/reveal";
  const body = JSON.stringify({ voucherId, ownerId });
  const res = await fetch(`${VOUCHER_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yourtal-service-signature": signServiceRequest(VOUCHER_SERVICE_SECRET, path, body),
    },
    body,
  });
  if (!res.ok) throw new Error(`reveal -> ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { code: string };
  return json.code;
}

/**
 * Studio normally registers a listing's ledger price when it is approved
 * (7.5-ish); my directly-inserted fixture listings skipped that, so
 * checkout's burn 404s with "the listing has no ledger price" until this
 * runs once. Real production route, called the same way apps/api itself
 * would (signed as "api"), just not through a Studio HTTP wrapper that
 * doesn't exist for a bare SQL-inserted fixture listing.
 */
async function priceListing(listingId: string, region: "AU" | "ID", currency: "AUD" | "IDR", settlementMinor: number): Promise<void> {
  const path = "/v1/pricing/listing";
  const body = JSON.stringify({ listingId, region, currency, settlementMinor });
  const res = await fetch(`${LEDGER_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yourtal-service-signature": signServiceRequest(LEDGER_SERVICE_SECRET, path, body),
    },
    body,
  });
  if (!res.ok) throw new Error(`priceListing -> ${res.status}: ${await res.text()}`);
}

interface RegionFixture {
  region: "AU" | "ID";
  currency: "AUD" | "IDR";
  listingId: string;
  settlementMinor: number;
  merchantId: string;
  ownerEmail: string;
  ownerPassword: string;
  locale: string;
  timezone: string;
}

async function runRegion(fx: RegionFixture): Promise<void> {
  console.log(`\n=== ${fx.region} (${fx.currency}) ===`);

  await priceListing(fx.listingId, fx.region, fx.currency, fx.settlementMinor);

  // 1. Register a consumer, log the link/earn/checkout flow (8.4.b).
  const consumerEmail = `e2e-consumer-${fx.region.toLowerCase()}-${Date.now()}@demo.yourtal.test`;
  const register = await api("POST", "/api/auth/register", {
    email: consumerEmail,
    password: "e2e-consumer-password-1",
    region: fx.region,
    locale: fx.locale,
    displayName: "e2e consumer",
    dateOfBirth: "1990-01-01",
    timezone: fx.timezone,
  });
  const consumerToken = register.token as string;
  console.log("registered consumer", register.userId);

  // 2. Link code (5.4.c).
  const link = await api("POST", "/api/me/linked-apps/code", {}, consumerToken);
  console.log("link code", link.code);

  // 3. Partner earn (8.4.a), signed as snap-app. Repeat until affordable.
  const listingQuote = await api(
    "POST",
    "/api/checkout/quote",
    { listingId: fx.listingId },
    consumerToken,
  );
  console.log("quote", listingQuote);
  const pricePoints = listingQuote.pricePoints as number;

  let earned = 0;
  let scan = 0;
  while (earned < pricePoints) {
    scan += 1;
    const body = JSON.stringify({
      user: link.code,
      action: "receipt_scanned",
      externalRef: `e2e-${fx.region}-${Date.now()}-${scan}`,
      evidence: {},
    });
    const sig = createHmac("sha256", "local-only-snap-app-partner-secret-not-real").update(body, "utf8").digest("hex");
    const res = await fetch(`${API}/api/partners/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Partner snap-app:${sig}`,
        "idempotency-key": idem(),
      },
      body,
    });
    if (!res.ok) throw new Error(`partner action -> ${res.status}: ${await res.text()}`);
    const granted = (await res.json()) as { granted: boolean; points: number };
    console.log("partner action", granted);
    earned += granted.points;
  }

  // 4. Checkout: quote again fresh (locks a price for 15 min) then confirm.
  const freshQuote = await api("POST", "/api/checkout/quote", { listingId: fx.listingId }, consumerToken);
  const confirmed = await api("POST", "/api/checkout", { checkoutId: freshQuote.checkoutId }, consumerToken);
  console.log("checkout confirmed", confirmed);
  if (confirmed.state !== "done" || !confirmed.voucherId) {
    throw new Error(`checkout did not complete: ${JSON.stringify(confirmed)}`);
  }

  // 5. Reveal the voucher's plaintext code (internal route, same as a
  // legitimate server-side caller would use -- see wallet_routes.go's own
  // reveal handler; the public wallet only ever hands back a QR token).
  const code = await revealCode(confirmed.voucherId, register.userId);
  console.log("revealed code", code);

  // 6. Business owner logs in, issues a sandbox credential and registers a webhook URL.
  const owner = await api("POST", "/api/auth/login", { email: fx.ownerEmail, password: fx.ownerPassword });
  const ownerToken = owner.token as string;
  const credential = await api(
    "POST",
    `/api/${fx.merchantId}/studio/developers/credentials`,
    { label: `e2e ${fx.region} sandbox`, sandbox: true },
    ownerToken,
  );
  console.log("issued credential", credential.credentialId);
  const webhookUrl = `https://example.test/webhooks/${fx.region.toLowerCase()}-${Date.now()}`;
  const webhook = await api(
    "POST",
    `/api/${fx.merchantId}/studio/developers/webhooks`,
    { url: webhookUrl },
    ownerToken,
  );
  console.log("registered webhook", webhook.url);

  // 7. Real SDK: authorize then capture the real voucher (8.3.d, 8.3.e).
  const client = createMerchantClient({
    baseUrl: VOUCHER_BASE,
    keyId: credential.credentialId,
    secret: Buffer.from(credential.secret, "hex"),
  });
  // Half the voucher's face value: balance_carrying (bootstrap policy fix
  // above) leaves it active with a remaining balance, so the refund step
  // below has real value to restore instead of hitting
  // ErrRefundNeedsReplacement on an already-fully-redeemed voucher.
  const orderTotalMinor = fx.currency === "IDR" ? 10_000 : 1_000;
  const amountMinor = fx.currency === "IDR" ? 10_000 : 1_000;
  const authorization = await client.authorize({
    code,
    amountMinor,
    currency: fx.currency,
    merchantOrderRef: `e2e-${fx.region}-${Date.now()}`,
    orderTotalMinor,
  });
  console.log("authorized", authorization);
  const capture = await client.capture({
    authorizationId: authorization.authorizationId,
    finalAmountMinor: amountMinor,
  });
  console.log("captured", capture);

  // 8. Replay the SAME capture call (same Idempotency-Key inside the SDK
  // client for one logical call -- here, calling capture() again for an
  // authorization that is already captured proves REPLAY at the
  // authorization-state level; the SDK's own idempotency-key replay is
  // proven by signing.test.ts/client.test.ts already).
  let replayRefused = false;
  try {
    await client.capture({ authorizationId: authorization.authorizationId, finalAmountMinor: amountMinor });
  } catch (error) {
    replayRefused = true;
    console.log("replayed capture refused as expected:", (error as Error).message);
  }
  if (!replayRefused) throw new Error("a second capture on the same authorization was NOT refused");

  // 9. Refund part of the capture. FINDING: every credential Studio's
  // issueCredential use-case mints is device-scoped
  // (voucher.merchant_credential.device_id set from the label), and
  // services/voucher's void/refund routes refuse ANY device-scoped
  // credential (routes_release.go's refuseDevicePrincipal) -- there is no
  // code path today that issues the "legacy merchant-wide" credential
  // void/refund still allow. Logged, not silently worked around: continue
  // to the summary either way, and null credential.device_id directly
  // (matching a superuser DB operation, not a real caller's capability)
  // for a REAL follow-up proof, in tmp-refund-followup.ts.
  let refundOk = true;
  try {
    const refund = await client.refund({
      receiptId: capture.receiptId,
      amountMinor: Math.floor(amountMinor / 2),
      reason: "e2e partial refund",
      refundRef: `e2e-refund-${fx.region}-${Date.now()}`,
    });
    console.log("refunded", refund);
  } catch (error) {
    refundOk = false;
    console.log(
      "FINDING: refund refused for a Studio-issued (device-scoped) credential:",
      (error as Error).message,
    );
  }

  // 10. The DB-side proof (exactly one delivered row per capture/refund,
  // plus signature verification) is a separate step --
  // packages/db/scripts/tmp-verify-webhooks.mjs -- since pg is not this
  // package's own dependency (packages/sdk-merchant ships standalone, no
  // workspace deps). Print what that step needs.
  console.log(
    "SUMMARY",
    JSON.stringify({
      region: fx.region,
      receiptId: capture.receiptId,
      webhookSecret: webhook.secret,
      credentialId: credential.credentialId,
      merchantId: fx.merchantId,
      ownerEmail: fx.ownerEmail,
      refundOk,
    }),
  );
}

async function main(): Promise<void> {
  const only = process.env["ONLY_REGION"];
  if (only === undefined || only === "AU") {
    await runRegion({
      region: "AU",
      currency: "AUD",
      listingId: process.argv[2]!,
      settlementMinor: 30,
      merchantId: "00000000-0000-4000-8000-000000000603",
      ownerEmail: process.argv[4]!,
      ownerPassword: "e2e-phase8c-bootstrap-pw-1",
      locale: "en-AU",
      timezone: "Australia/Sydney",
    });
  }
  if (only === undefined || only === "ID") {
    await runRegion({
      region: "ID",
      currency: "IDR",
      listingId: process.argv[3]!,
      settlementMinor: 600,
      merchantId: "00000000-0000-4000-8000-000000000601",
      ownerEmail: process.argv[5]!,
      ownerPassword: "e2e-phase8c-bootstrap-pw-1",
      locale: "id-ID",
      timezone: "Asia/Jakarta",
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
