import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import pg from "pg";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { grantActionRequestSchema } from "@yourtal/contracts/ledger-internal/rewards";
import { priceListingRequestSchema } from "@yourtal/contracts/ledger-internal/pricing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";

/**
 * 6.5.c's Check, against a LIVE ledger and voucher service (not
 * `LEDGER_MODE=fake`) — see `playwright.b-wallet.config.ts` for why this
 * spec has its own config, same reasoning as `a-identity-plumbing.spec.ts`.
 *
 * `WALLET_VOUCHER_LIVE=1` opt-in gate, same convention as
 * `checkout.live.test.ts`'s `CHECKOUT_LIVE=1`: this spec needs a REAL
 * checkout saga to dispute, which needs a REAL priced listing —
 * `disputeVoucher` (apps/api's checkout module) looks up `checkout.saga` by
 * voucher id, and there is no way to get one without a real burn. F40:
 * this does NOT wait on Phase 7 — `store.listings` already exists as a
 * migration (Phase 0/1), and `checkout.live.test.ts`'s own `listing()`
 * helper (4.7.d, already ✅ on main) seeds one exactly this way: a raw
 * insert plus the ledger's real `priceListing` and the voucher service's
 * real `requestBatch`/`approveBatch`. This spec reuses that same recipe.
 *
 * Run it like this, from the repo root, with your slot's `.env` sourced:
 *
 *   # 1. Build and start a real ledger + voucher against YOUR OWN slot db
 *   #    (never the shared 26910/26911 containers — those point at the
 *   #    shared `yourtal` database, not your slot's, and a stale image may
 *   #    not match current source; see this file's report for both traps).
 *   cd services/ledger && go build -o /tmp/wv-ledger.exe ./cmd/ledger
 *   cd services/voucher && go build -o /tmp/wv-voucher.exe ./cmd/voucher
 *   mkdir -p /tmp/wv-keys && for k in voucher_code merchant_hmac voucher_qr; do
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > /tmp/wv-keys/$k.v1.key
 *   done
 *   LEDGER_ADDR=127.0.0.1:27110 LEDGER_DATABASE_URL=$LEDGER_DATABASE_URL \
 *     LEDGER_SERVICE_SECRET=local-only-ledger-service-secret-not-real \
 *     REWARD_ATTESTATION_SECRET=local-only-reward-attestation-secret-not-real \
 *     APP_ENV=dev /tmp/wv-ledger.exe &
 *   VOUCHER_ADDR=127.0.0.1:27111 VOUCHER_DATABASE_URL=$VOUCHER_DATABASE_URL \
 *     VOUCHER_SERVICE_SECRET=local-only-voucher-service-secret-not-real \
 *     LEDGER_BASE_URL=http://127.0.0.1:27110 \
 *     LEDGER_SERVICE_SECRET=local-only-ledger-service-secret-not-real \
 *     VOUCHER_KEY_DIR=/tmp/wv-keys APP_ENV=dev /tmp/wv-voucher.exe &
 *   # 2. Start apps/api pointed at them
 *   LEDGER_MODE=live LEDGER_BASE_URL=http://127.0.0.1:27110 \
 *     VOUCHER_BASE_URL=http://127.0.0.1:27111 \
 *     LEDGER_SERVICE_SECRET=local-only-ledger-service-secret-not-real \
 *     VOUCHER_SERVICE_SECRET=local-only-voucher-service-secret-not-real \
 *     REWARD_ATTESTATION_SECRET=local-only-reward-attestation-secret-not-real \
 *     pnpm --filter @yourtal/api dev &
 *   # 3. Run this spec
 *   WALLET_VOUCHER_LIVE=1 pnpm --filter @yourtal/web exec playwright test \
 *     --config=playwright.b-wallet.config.ts
 *
 * Verified once, live, 2026-09-27 (see this ticket's final report for the
 * exact HTTP/DB transcript): a real `POST /api/checkout` burn against a
 * seeded listing minted a real voucher; the wallet showed it; the QR
 * fetched a second real signed token once the first's window (real
 * `expiresAt` from `services/voucher`'s keyring) passed; the dispute call
 * reinstated the exact points once, replaying identically on a second call,
 * with `checkout.dispute` and `voucher.vouchers.state = 'voided'` rows to
 * match.
 */
const live = process.env["WALLET_VOUCHER_LIVE"] === "1";
test.skip(!live, "needs a live ledger+voucher — see this file's header for how to run it");

const LEDGER_BASE_URL = process.env["LEDGER_BASE_URL"] ?? "http://127.0.0.1:27110";
const VOUCHER_BASE_URL = process.env["VOUCHER_BASE_URL"] ?? "http://127.0.0.1:27111";
const LEDGER_SECRET =
  process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real";
const VOUCHER_SECRET =
  process.env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real";
const DATABASE_OWNER_URL =
  process.env["DATABASE_OWNER_URL"] ??
  "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s3b";

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error("API_INTERNAL_URL is not set — source this worktree's .env first.");
  }
  return url;
}

async function signedPost(
  baseUrl: string,
  secret: string,
  path: string,
  payload: unknown,
): Promise<unknown> {
  const body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
        secret,
        caller: "api",
        method: "POST",
        pathAndQuery: path,
        body,
      }),
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return JSON.parse(text);
}

/** The exact recipe `checkout.live.test.ts`'s `listing()` helper uses (4.7.d, already ✅ on main) — a buyable AU listing, priced and stocked. */
async function seedListing(pool: pg.Pool): Promise<string> {
  const listingId = randomUUID();
  const merchantId = randomUUID();
  const locationId = randomUUID();
  const face = 2_000; // AUD $20.00
  const settlement = 600; // AUD $6.00

  await pool.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category,
        face_value_minor, settlement_value_minor, price_in_points,
        stock_remaining, stock_total, transferable, partial_redemption_policy,
        minimum_spend_minor, expires_at, status, lifecycle_state, currency, region, audience,
        content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'B Wallet E2E Merchant', 'B Wallet E2E Listing',
             '6.5.c live check fixture', 'food-and-drink',
             $3, $4, 1000, 5, 5, false, 'single_use_forfeit',
             NULL, now() + interval '90 days', 'available', 'active', 'AUD', 'AU',
             'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
             'in_store', 'single_use')`,
    [listingId, merchantId, face, settlement],
  );
  await pool.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
     VALUES ($1, $2, 'B Wallet E2E Branch', '1 Test St', 'Test District')`,
    [locationId, merchantId],
  );
  await pool.query(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`, [
    listingId,
    locationId,
  ]);

  await signedPost(
    LEDGER_BASE_URL,
    LEDGER_SECRET,
    "/v1/pricing/listing",
    priceListingRequestSchema.parse({
      listingId,
      region: "AU",
      currency: "AUD",
      settlementMinor: toMinorUnits(settlement),
    }),
  );
  const batch = (await signedPost(VOUCHER_BASE_URL, VOUCHER_SECRET, "/internal/v1/batches", {
    listingId,
    merchantId,
    currency: "AUD",
    faceValueMinor: toMinorUnits(face),
    quantity: 5,
    partialRedemptionPolicy: "single_use_forfeit",
    requestedBy: "staff-1",
  })) as { batchId: string };
  await signedPost(VOUCHER_BASE_URL, VOUCHER_SECRET, "/internal/v1/batches/approve", {
    batchId: batch.batchId,
    approvedBy: "staff-2",
  });
  return listingId;
}

/** `kind: "goodwill"`, `trustTier: 3` — no holdback (matches `checkout.live.test.ts`'s `earn()`), so the grant is available immediately, no `/api/dev/clock/release-pending` needed. */
async function grantPoints(userId: string, points: number): Promise<void> {
  await signedPost(
    LEDGER_BASE_URL,
    LEDGER_SECRET,
    "/v1/actions/grants",
    grantActionRequestSchema.parse({
      kind: "goodwill",
      userId,
      region: "AU",
      points: toPoints(points),
      trustTier: 3,
      idempotencyKey: `b-wallet-voucher-live-${randomUUID()}`,
    }),
  );
}

interface TestAccount {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** Fixed, not random: `auth.register` is capped at 5/IP/hour (same limit `a-identity-plumbing.spec.ts` documents), and this spec is re-run often while iterating. `ensureAccount` below registers it only the first time this ever runs against a given database. */
const FIXED_ACCOUNT: TestAccount = {
  email: "b-wallet-e2e@example.com",
  password: "correct horse battery staple",
  displayName: "E2E Wallet Tester",
};

interface AuthResult {
  readonly userId: string;
  readonly token: string;
}

async function registerAccount(
  request: APIRequestContext,
  account: TestAccount,
): Promise<AuthResult> {
  const response = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      email: account.email,
      password: account.password,
      region: "AU",
      locale: "en-AU",
      displayName: account.displayName,
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
  });
  expect(response.ok(), `register failed: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as AuthResult;
}

/** Logs in first (cheap, no rate limit worth mentioning) and only falls back to registering if the account genuinely does not exist yet. */
async function ensureAccount(
  request: APIRequestContext,
  account: TestAccount,
): Promise<AuthResult> {
  const login = await request.post(`${apiBaseUrl()}/api/auth/login`, {
    data: { email: account.email, password: account.password },
  });
  if (login.ok()) {
    return (await login.json()) as AuthResult;
  }
  return registerAccount(request, account);
}

async function signInThroughLoginAction(page: Page, account: TestAccount): Promise<void> {
  await page.goto(`/dev/login?returnTo=%2Fwallet`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Generous timeout: `/wallet` may need Next dev-mode JIT compilation the
  // first time this worker visits it, on top of the real login round trip.
  await expect(page).toHaveURL(/\/wallet$/, { timeout: 30_000 });
}

let account: TestAccount;
let token: string;
let userId: string;
let listingId: string;
let voucherId: string;
let pool: pg.Pool;
/** The fixed account is reused across runs (see `FIXED_ACCOUNT`'s comment), so every balance assertion below is relative to whatever it already held, never an absolute number. */
let balanceBeforeGrant: number;
const GRANT_POINTS = 500;

async function walletBalanceViaToken(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${apiBaseUrl()}/api/wallet`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { availablePoints: number }).availablePoints;
}

/** How much `grantPoints` actually added — 0 when the region's daily earn cap (F12) already had no room left for this reused account, in which case its existing balance (still checked to cover the listing price below) carries the run instead. Grants and burns are on separate caps: only grants touch the daily earn cap, so a capped-out account can still check out and dispute freely. */
let actuallyGranted = 0;

test.beforeAll(async ({ request, browser }) => {
  pool = new pg.Pool({ connectionString: DATABASE_OWNER_URL });
  account = FIXED_ACCOUNT;
  const auth = await ensureAccount(request, account);
  userId = auth.userId;
  token = auth.token;
  balanceBeforeGrant = await walletBalanceViaToken(request);
  listingId = await seedListing(pool);
  try {
    await grantPoints(userId, GRANT_POINTS);
    actuallyGranted = GRANT_POINTS;
  } catch (error) {
    if (!String(error).includes("velocity_capped")) throw error;
    expect(
      balanceBeforeGrant,
      "no earn-cap room left today and no existing balance to fall back on",
    ).toBeGreaterThan(200);
  }

  // Warm `next dev`'s JIT compile of the voucher detail route (a fake id
  // 404s, which is fine — only the route bundle needs to exist) before the
  // timed tests below navigate to it. On a contended machine, a route's
  // FIRST-ever hit can take well past this spec's per-test timeout; every
  // hit after the first is fast, which is exactly the gap this closes.
  const warmupPage = await (await browser.newContext()).newPage();
  await warmupPage
    .goto("/wallet/voucher/00000000-0000-0000-0000-000000000000", { timeout: 180_000 })
    .catch(() => {});
  await warmupPage.context().close();
});

test.afterAll(async () => {
  await pool.end();
});

test.describe("6.5.c: wallet and voucher against a live ledger + voucher service", () => {
  test("a real checkout burns real points and the wallet shows the voucher immediately", async ({
    page,
    request,
  }) => {
    await signInThroughLoginAction(page, account);
    const balanceAfterGrant = await walletBalanceViaToken(request);
    expect(balanceAfterGrant).toBe(balanceBeforeGrant + actuallyGranted);
    // The real, live-rendered balance card — its exact aria-label is the
    // number `PointsChip` formats, asserted numerically above; here just
    // confirm the browser is actually showing IT (not stale/mock data).
    await expect(page.locator(`[aria-label="${balanceAfterGrant} available"]`)).toBeVisible();

    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const quoted = await request.post(`${apiBaseUrl()}/api/checkout/quote`, {
      headers: { cookie },
      data: { listingId },
    });
    expect(quoted.ok()).toBeTruthy();
    const quote = (await quoted.json()) as { checkoutId: string; pricePoints: number };

    const checkedOut = await request.post(`${apiBaseUrl()}/api/checkout`, {
      headers: { cookie, "idempotency-key": randomUUID() },
      data: { checkoutId: quote.checkoutId },
    });
    expect(checkedOut.ok()).toBeTruthy();
    const result = (await checkedOut.json()) as { voucherId: string; state: string };
    expect(result.state).toBe("done");
    voucherId = result.voucherId;

    const balanceAfterBurn = await walletBalanceViaToken(request);
    expect(balanceAfterBurn).toBe(balanceAfterGrant - quote.pricePoints);
    await page.reload();
    await expect(page.locator(`[aria-label="${balanceAfterBurn} available"]`)).toBeVisible();
    // The live wallet-voucher read is still the narrow `{voucherId, listingId,
    // state}` shape (this ticket's "(requested by B)" ask under 4.8 in
    // TASKS.md) — no merchant name or title yet, so the card shows the
    // generic placeholder title, not the listing's real name. What IS real
    // and provable here is that this exact voucher is present and links to
    // its own detail page.
    await expect(page.locator(`a[href="/wallet/voucher/${voucherId}"]`)).toBeVisible();
  });

  test("the live QR endpoint mints a genuinely fresh signed token on request", async ({
    request,
  }) => {
    // Decoupled from browser timing (see the next test for the in-browser
    // rotation itself, which `use-voucher-qr-rotation.test.tsx` already
    // covers deterministically with fake vitest timers): this is the direct
    // proof that `services/voucher`'s keyring signs a NEW token each call,
    // not a cached/static one.
    const first = await request.get(`${apiBaseUrl()}/api/wallet/vouchers/${voucherId}/qr`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.ok()).toBeTruthy();
    const second = await request.get(`${apiBaseUrl()}/api/wallet/vouchers/${voucherId}/qr`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.ok()).toBeTruthy();
    const firstToken = ((await first.json()) as { token: string }).token;
    const secondToken = ((await second.json()) as { token: string }).token;
    expect(secondToken).not.toBe(firstToken);
  });

  test("the QR renders from a real signed token and keeps showing with the network off", async ({
    page,
  }) => {
    await signInThroughLoginAction(page, account);
    await page.goto(`/wallet/voucher/${voucherId}`, { waitUntil: "networkidle" });

    const qrImage = page.getByRole("img", { name: /Redemption QR code/ });
    await expect(qrImage).toBeVisible();
    const firstSrc = await qrImage.getAttribute("src");
    expect(firstSrc).toBeTruthy();
    // The in-browser rotation-onto-a-fresh-window mechanism itself is
    // `use-voucher-qr-rotation.test.tsx`'s job (fake vitest timers, no live
    // server needed) and the previous test already proves the LIVE server
    // mints a new token per request — `page.clock` was tried here too, but
    // installing a fake clock on a `next dev` page (not a production build)
    // starves its HMR client's own real timers and hangs the tab; not worth
    // fighting in a spec whose whole point is the offline half below.

    // Now the offline half of 6.5.c: the network drops, and the voucher —
    // already rendered from this page's own live fetch — keeps showing.
    // `networkidle` above matters here specifically: toggling offline while
    // a request is genuinely in flight (a stray RSC prefetch, say) can abort
    // that stream server-side badly enough under `next dev` to wedge the
    // route for whichever request comes next — this test's own dispute
    // sibling included, since both share this one voucher/page. Isolating a
    // `page`/`context` per test does not help; the wedge lives in the Next
    // dev SERVER process, not the client.
    await page.context().setOffline(true);
    try {
      await expect(page.getByText("You're offline")).toBeVisible();
      await expect(qrImage).toBeVisible();
    } finally {
      await page.context().setOffline(false);
      // Let anything the offline window queued (a retried fetch, a
      // reconnect) actually settle before the next test reuses this route.
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  });

  test("disputing an unused voucher returns its points exactly once, with real ledger and DB rows", async ({
    page,
    request,
  }) => {
    await signInThroughLoginAction(page, account);
    const beforeBalance = await walletBalanceViaToken(request);

    await page.goto(`/wallet/voucher/${voucherId}`);
    await page.getByRole("button", { name: "This voucher didn't work" }).click();
    // `.check()`, not `.click()`: `ChoiceCard`'s radio input is visually
    // `sr-only` behind its own label text, which real users click through
    // native label semantics — Playwright's actionability check on the
    // (correctly) not-directly-clickable input needs the same allowance.
    await page.getByRole("radio", { name: "The merchant wouldn't accept it" }).check();
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Your points are back in your wallet.")).toBeVisible();

    const afterBalance = await walletBalanceViaToken(request);
    expect(afterBalance).toBeGreaterThan(beforeBalance);
    const reinstated = afterBalance - beforeBalance;
    expect(reinstated).toBeGreaterThan(0);

    // Real DB rows: exactly one dispute row, and the voucher voided.
    const disputeRows = await pool.query(
      "SELECT reason, outcome FROM checkout.dispute WHERE voucher_id = $1",
      [voucherId],
    );
    expect(disputeRows.rows).toEqual([{ reason: "not_honoured", outcome: "reinstated" }]);
    const voucherRows = await pool.query("SELECT state FROM voucher.vouchers WHERE id = $1", [
      voucherId,
    ]);
    expect(voucherRows.rows[0]?.state).toBe("voided");

    // A second dispute call must not double-credit — replay, not a repeat.
    const secondDispute = await request.post(
      `${apiBaseUrl()}/api/wallet/vouchers/${voucherId}/dispute`,
      {
        headers: { authorization: `Bearer ${token}`, "idempotency-key": randomUUID() },
        data: { reason: "not_honoured" },
      },
    );
    expect(secondDispute.ok()).toBeTruthy();
    expect(await walletBalanceViaToken(request)).toBe(afterBalance);
  });
});

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const viewport of VIEWPORTS) {
  for (const colorScheme of THEMES) {
    test.describe(`${viewport.name}px, ${colorScheme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, colorScheme });

      test("/wallet and the voucher pass render and pass axe (WCAG AA)", async ({ page }) => {
        await signInThroughLoginAction(page, account);
        await expect(page.getByRole("heading", { name: "Wallet", level: 1 })).toBeVisible();
        await page.screenshot({
          path: `test-results/b-wallet-${viewport.name}-${colorScheme}.png`,
          fullPage: true,
        });
        const walletAxe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          walletAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toStrictEqual([]);

        await page.goto(`/wallet/voucher/${voucherId}`);
        await page.screenshot({
          path: `test-results/b-wallet-voucher-${viewport.name}-${colorScheme}.png`,
          fullPage: true,
        });
        const voucherAxe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          voucherAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toStrictEqual([]);
      });
    });
  }
}
