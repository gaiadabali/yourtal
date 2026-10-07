import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { REGIONS, apiRegister, useSession, type RegionCase } from "./demo";
import {
  callerFor,
  closeDb,
  db,
  demoCaller,
  eitherLocale,
  msg,
  one,
  requireBusinessEnv,
  staffCaller,
  type Caller,
} from "./business";

const PIN = "4826";
const VOUCHER_URL = process.env["VOUCHER_BASE_URL"] ?? "http://127.0.0.1:26333";

interface Pick {
  viewer: Caller;
  person: string;
  voucherId: string;
  merchantId: string;
  locationId: string;
  remaining: number;
}

/**
 * The demo owner's cheapest reward a day's goodwill can buy, restocked the
 * way a merchant restocks: the owner asks for a batch, a moderator approves.
 */
async function restockedReward(request: APIRequestContext, owner: Caller, r: RegionCase) {
  const listing = await one<{ id: string; merchant_id: string }>(
    `SELECT l.id::text, l.merchant_id::text FROM store.listings l
       JOIN business.business_members m ON m.business_id = l.merchant_id AND m.role = 'owner'
      WHERE m.user_id = $1 AND l.region = $2 AND l.lifecycle_state = 'active'
        AND l.audience IN ('all_ages', 'adult') AND l.expires_at > now()
      ORDER BY l.price_in_points, l.id LIMIT 1`,
    [owner.userId, r.region],
  );
  const batch = await owner.post<{ id: string }>(
    `/api/${listing.merchant_id}/store/voucher-batch-requests`,
    { listingId: listing.id, quantity: 2, reason: "Journey 8 restock." },
  );
  const moderator = await staffCaller(request, "moderator");
  await moderator.post(`/api/staff/moderation/voucher-batches/${batch.id}/approve`, {
    reason: "Restock for a verified merchant.",
  });
  return listing.id;
}

/**
 * A reward the online merchant can redeem over HMAC. Demo rewards are mostly
 * in-store only (AU has none online), so the demo owner lists a fresh one, as
 * journey 4 shows on screen, and restocks it the same way.
 */
async function onlineReward(request: APIRequestContext, owner: Caller, r: RegionCase) {
  const base = await one<{ merchant_id: string; location_id: string; image_url: string }>(
    `SELECT l.merchant_id::text, ll.location_id::text, l.image_url
       FROM store.listings l
       JOIN business.business_members m ON m.business_id = l.merchant_id AND m.role = 'owner'
       JOIN store.listing_location ll ON ll.listing_id = l.id
      WHERE m.user_id = $1 AND l.region = $2 AND l.lifecycle_state = 'active'
      ORDER BY l.id LIMIT 1`,
    [owner.userId, r.region],
  );
  const au = r.region === "AU";
  const listing = await owner.post<{ id: string }>(`/api/${base.merchant_id}/store/listings`, {
    merchantName: "Journey 8 online",
    title: `Journey 8 online voucher ${Date.now().toString(36)}`,
    description: "Redeemed on the merchant's web shop.",
    category: "retail",
    locationIds: [base.location_id],
    faceValueMinor: au ? 1_000 : 50_000,
    settlementValueMinor: au ? 700 : 35_000,
    stockTotal: 2,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    status: "available",
    audience: "all_ages",
    contentCategory: "electronics",
    tags: [],
    imageUrl: base.image_url,
    channel: "online",
    partialRedemption: "single_use",
  });
  const batch = await owner.post<{ id: string }>(
    `/api/${base.merchant_id}/store/voucher-batch-requests`,
    { listingId: listing.id, quantity: 2, reason: "Journey 8 online restock." },
  );
  const moderator = await staffCaller(request, "moderator");
  await moderator.post(`/api/staff/moderation/voucher-batches/${batch.id}/approve`, {
    reason: "Restock for a verified merchant.",
  });
  return listing.id;
}

/**
 * A fresh customer who buys that reward in the store: an admin goodwill
 * credit (the day's earn cap), released, then checkout, as the demo seed
 * does (journey 7 proves buying on screen).
 */
async function customerWithVoucher(
  request: APIRequestContext,
  listingId: string,
  r: RegionCase,
  tag: string,
): Promise<Pick> {
  const viewer = callerFor(request, await apiRegister(request, r, `j08-${tag}`));
  const admin = await staffCaller(request, "admin");
  await admin.post(`/api/staff/users/${viewer.userId}/goodwill`, {
    points: r.region === "AU" ? 500 : 5_000,
    reason: "Journey 8 customer balance.",
  });
  await viewer.post("/api/dev/clock/release-pending", {});
  const quote = await viewer.post<{ checkoutId: string }>("/api/checkout/quote", { listingId });
  const bought = await viewer.post<{ voucherId: string }>("/api/checkout", {
    checkoutId: quote.checkoutId,
  });
  const voucher = await one<{ merchant_id: string; location_id: string | null; remaining: string }>(
    `SELECT merchant_id::text, location_id::text, remaining_value_minor::text AS remaining
       FROM voucher.vouchers WHERE id = $1 AND owner_id = $2 AND state = 'active'`,
    [bought.voucherId, viewer.userId],
  );
  const location =
    voucher.location_id ??
    (
      await one<{ location_id: string }>(
        `SELECT location_id::text FROM store.listing_location WHERE listing_id = $1 LIMIT 1`,
        [listingId],
      )
    ).location_id;
  return {
    viewer,
    person: tag,
    voucherId: bought.voucherId,
    merchantId: voucher.merchant_id,
    locationId: location,
    remaining: Number(voucher.remaining),
  };
}

/**
 * What the counter's scanner would read: the Wallet screen shows the rotating
 * QR, and its payload is the `/qr` token. The Wallet shows no readable code
 * online (13.3.o), and a headless counter has no camera, so staff type it.
 */
async function qrFromWallet(browser: Browser, baseURL: string, pick: Pick, r: RegionCase) {
  const context = await browser.newContext();
  await useSession(context, baseURL, pick.viewer.token, r);
  const page = await context.newPage();
  await page.goto(`/wallet/voucher/${pick.voucherId}`);
  await expect(page.locator('img[src^="data:image/png;base64,"]').first()).toBeVisible();
  await context.close();
  const { token } = await pick.viewer.get<{ token: string }>(
    `/api/wallet/vouchers/${pick.voucherId}/qr`,
  );
  return token;
}

/** One HMAC-signed merchant call, exactly as the Studio developer docs describe. */
async function merchantCall(keyId: string, secret: string, path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const idempotencyKey = randomUUID();
  const t = Math.floor(Date.now() / 1000);
  const canonical = [
    String(t),
    keyId,
    "POST",
    path,
    idempotencyKey,
    createHash("sha256").update(raw).digest("base64"),
  ].join("\n");
  // The secret Studio shows is hex: the key is its bytes.
  const v1 = createHmac("sha256", Buffer.from(secret, "hex")).update(canonical).digest("hex");
  const response = await fetch(`${VOUCHER_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-yourtal-signature": `t=${t},k=${keyId},v1=${v1}`,
    },
    body: raw,
  });
  const text = await response.text();
  expect(response.ok, `${path}: ${response.status} ${text}`).toBeTruthy();
  return JSON.parse(text) as Record<string, unknown>;
}

/** The ledger posting a capture makes (asynchronously), balanced. */
async function expectCapturePosted(captureId: string) {
  await expect
    .poll(
      async () =>
        (
          await db().query(`SELECT 1 FROM ledger.transfer WHERE idempotency_key = $1`, [
            `capture_${captureId}`,
          ])
        ).rowCount,
      { timeout: 30_000 },
    )
    .toBe(1);
  const { rows } = await db().query<{ sum: string; legs: string }>(
    `SELECT sum(e.amount_minor)::text AS sum, count(*)::text AS legs
       FROM ledger.entry e JOIN ledger.transfer t ON t.id = e.transfer_id
      WHERE t.idempotency_key = $1`,
    [`capture_${captureId}`],
  );
  expect(rows[0]?.sum).toBe("0");
  expect(Number(rows[0]?.legs)).toBeGreaterThanOrEqual(2);
}

/**
 * Journey 8 (product-intent §2.2): store staff pair a counter, unlock it with
 * the PIN, type the code the customer reads off their Wallet; the device
 * authorizes and captures and both sides show the receipt. An online merchant
 * makes the same two calls with a Studio-issued HMAC credential. Checks the
 * authorization, capture and counter-log rows, the voucher's state and the
 * ledger posting for each capture.
 */
test.afterAll(closeDb);

for (const r of REGIONS) {
  test(`J8 ${r.region}: a counter redeems with the PIN`, async ({ browser, request, baseURL }) => {
    test.setTimeout(240_000);
    requireBusinessEnv();
    const owner = await demoCaller(request, "owner", r);
    const reward = await restockedReward(request, owner, r);
    const atCounter = await customerWithVoucher(request, reward, r, "counter");
    const m = (key: string) => msg(r, "merchant", key);

    // Studio: the owner provisions a counter with its PIN.
    const provisioned = await owner.post<{ pairingCode: string }>(
      `/api/${atCounter.merchantId}/studio/devices`,
      {
        locationId: atCounter.locationId,
        label: r.region === "AU" ? "Journey counter" : "Kasir journey",
        pin: PIN,
      },
    );

    // The counter: pair, lock, a wrong PIN refused, the right one unlocks.
    const counter = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await counter.addCookies([{ name: "yt_locale", value: r.locale, url: baseURL! }]);
    const page = await counter.newPage();
    await page.goto(`${baseURL}/merchant/pair`);
    // Until its first PIN unlock the counter does not know its shop's region or language.
    const e = (key: string) => eitherLocale("merchant", key);
    await page.getByLabel(e("provisioning.form.codeLabel")).fill(provisioned.pairingCode);
    await page.getByRole("button", { name: e("provisioning.form.submitButton") }).click();
    await page.getByRole("button", { name: e("provisioning.lockButton") }).click();
    await page.getByLabel(e("provisioning.pinLabel")).fill("0000");
    await page.getByRole("button", { name: e("provisioning.unlockButton") }).click();
    await expect(page.getByText(e("provisioning.errorWrongPin"))).toBeVisible();
    await page.getByLabel(e("provisioning.pinLabel")).fill(PIN);
    await page.getByRole("button", { name: e("provisioning.unlockButton") }).click();
    // From here it speaks the shop's language.
    await expect(page.getByRole("tab", { name: m("portal.tabManual") })).toBeVisible();

    // The customer shows their Wallet; staff enter what the QR carries.
    const code = await qrFromWallet(browser, baseURL!, atCounter, r);
    const tab = page.getByRole("tab", { name: m("portal.tabManual") });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    await page.getByLabel(m("portal.manualCodeLabel"), { exact: true }).fill(code);
    await page.getByRole("button", { name: m("portal.lookUpButton") }).click();
    const amount = page.getByLabel(m("portal.amountLabel"));
    if (await amount.isVisible().catch(() => false)) await amount.fill(String(atCounter.remaining));
    await page.getByRole("button", { name: m("portal.confirmButton") }).click();
    await expect(page.getByText(m("portal.successHeading"), { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `test-results/j08-counter-${r.slug}.png`, fullPage: true });
    await counter.close();

    // One captured authorization from that device; the counter's log; the voucher spent.
    const auth = await one<{
      id: string;
      state: string;
      device_id: string | null;
      amount: string;
      captured: string;
      capture_id: string;
    }>(
      `SELECT a.id::text, a.state, a.device_id::text, a.amount_minor::text AS amount,
              c.amount_minor::text AS captured, c.id::text AS capture_id
         FROM voucher.authorization a JOIN voucher.capture c ON c.authorization_id = a.id
        WHERE a.voucher_id = $1`,
      [atCounter.voucherId],
    );
    expect(auth.device_id).not.toBeNull();
    expect(auth.captured).toBe(auth.amount);
    const logged = await one<{ device: string; location: string }>(
      `SELECT device_id::text AS device, location_id::text AS location FROM store.counter_capture_log WHERE voucher_id = $1`,
      [atCounter.voucherId],
    );
    expect(logged).toEqual({ device: auth.device_id, location: atCounter.locationId });
    const spent = await one<{ state: string; remaining: string }>(
      `SELECT state, remaining_value_minor::text AS remaining FROM voucher.vouchers WHERE id = $1`,
      [atCounter.voucherId],
    );
    expect(spent.state).toBe(Number(spent.remaining) === 0 ? "redeemed" : "partially_redeemed");
    await expectCapturePosted(auth.capture_id);

    // The customer's side shows it redeemed.
    const after = await atCounter.viewer.get<{
      vouchers: { voucherId: string; status?: string }[];
    }>("/api/wallet/vouchers");
    expect(after.vouchers.find((v) => v.voucherId === atCounter.voucherId)?.status).not.toBe(
      "active",
    );
  });

  test(`J8 ${r.region} online: an online merchant redeems over HMAC`, async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    // Expected to fail until 13.3.w: checkout reads `store.listings.stock_remaining`, which
    // nothing raises when a batch is minted, so a merchant's own new listing is never buyable.
    test.fail(true, "13.3.w: checkout ignores the minted stock of a new listing");
    requireBusinessEnv();
    const owner = await demoCaller(request, "owner", r);
    const reward = await onlineReward(request, owner, r);
    const online = await customerWithVoucher(request, reward, r, "online");

    // Online: a Studio-issued credential, then authorize and capture over HMAC.
    const credential = await owner.post<{ credentialId: string; secret: string }>(
      `/api/${online.merchantId}/studio/developers/credentials`,
      { label: `Journey 8 web shop ${r.region}`, sandbox: true },
    );
    const onlineCode = await qrFromWallet(browser, baseURL!, online, r);
    const currency = r.region === "AU" ? "AUD" : "IDR";
    const authorized = await merchantCall(
      credential.credentialId,
      credential.secret,
      "/v1/vouchers/authorize",
      {
        code: onlineCode,
        amount: online.remaining,
        currency,
        merchant_order_ref: `j08-web-${randomUUID()}`,
      },
    );
    const captured = await merchantCall(
      credential.credentialId,
      credential.secret,
      "/v1/vouchers/capture",
      {
        authorization_id: authorized["authorization_id"],
        final_amount: online.remaining,
      },
    );
    expect(captured["amount_captured"]).toBe(online.remaining);
    const webAuth = await one<{ state: string; device_id: string | null; capture_id: string }>(
      `SELECT a.state, a.device_id::text, c.id::text AS capture_id
         FROM voucher.authorization a JOIN voucher.capture c ON c.authorization_id = a.id
        WHERE a.voucher_id = $1`,
      [online.voucherId],
    );
    expect(webAuth.device_id).toBeNull();
    await expectCapturePosted(webAuth.capture_id);

    // A forged signature is refused.
    const forged = await fetch(`${VOUCHER_URL}/v1/vouchers/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yourtal-signature": `t=1,k=${credential.credentialId},v1=00`,
      },
      body: "{}",
    });
    expect(forged.status).toBe(401);
  });
}
