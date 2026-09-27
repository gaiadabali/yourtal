import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import pg from "pg";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { grantActionRequestSchema } from "@yourtal/contracts/ledger-internal/rewards";
import { priceListingRequestSchema } from "@yourtal/contracts/ledger-internal/pricing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";

/**
 * Shared live-stack fixture for the two specs that need a REAL, disputable
 * voucher against a REAL ledger + voucher service: 6.5.c
 * (`b-wallet-voucher.spec.ts`) and 6.9 (`offline-voucher-detail.spec.ts`).
 * One recipe, reused, rather than two copies drifting apart — see either
 * spec's own header for the exact commands to stand up the ledger/voucher
 * pair this calls into and why it must be built from source against your
 * OWN slot database, never the shared 26910/26911 containers.
 */

export const LEDGER_BASE_URL = process.env["LEDGER_BASE_URL"] ?? "http://127.0.0.1:27110";
export const VOUCHER_BASE_URL = process.env["VOUCHER_BASE_URL"] ?? "http://127.0.0.1:27111";
const LEDGER_SECRET =
  process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real";
const VOUCHER_SECRET =
  process.env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real";
export const DATABASE_OWNER_URL =
  process.env["DATABASE_OWNER_URL"] ??
  "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s3b";

export function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error("API_INTERNAL_URL is not set — source this worktree's .env first.");
  }
  return url;
}

export function openLiveDbPool(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_OWNER_URL });
}

export async function signedPost(
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
export async function seedListing(pool: pg.Pool): Promise<string> {
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
     VALUES ($1, $2, 'Live E2E Merchant', 'Live E2E Listing',
             'seeded for a live e2e check', 'food-and-drink',
             $3, $4, 1000, 5, 5, false, 'single_use_forfeit',
             NULL, now() + interval '90 days', 'available', 'active', 'AUD', 'AU',
             'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
             'in_store', 'single_use')`,
    [listingId, merchantId, face, settlement],
  );
  await pool.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
     VALUES ($1, $2, 'Live E2E Branch', '1 Test St', 'Test District')`,
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

/** `kind: "goodwill"`, `trustTier: 3` — no holdback (matches `checkout.live.test.ts`'s `earn()`), so the grant is available immediately, no `/api/dev/clock/release-pending` needed. Throws `velocity_capped` once this account's real daily earn cap (F12) is already spent for today — callers fall back to whatever balance the account already has. */
export async function grantPoints(userId: string, points: number): Promise<void> {
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
      idempotencyKey: `live-e2e-grant-${randomUUID()}`,
    }),
  );
}

export interface TestAccount {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface AuthResult {
  readonly userId: string;
  readonly token: string;
}

export async function registerAccount(
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

/** Logs in first (cheap, no rate limit worth mentioning) and only falls back to registering if the account genuinely does not exist yet — `auth.register` is capped at 5/IP/hour (same limit `a-identity-plumbing.spec.ts` documents), and these specs are re-run often while iterating. */
export async function ensureAccount(
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

export async function walletBalanceViaToken(
  request: APIRequestContext,
  token: string,
): Promise<number> {
  const response = await request.get(`${apiBaseUrl()}/api/wallet`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { availablePoints: number }).availablePoints;
}

/**
 * Grants `points` if today's real earn cap (F12) allows it; otherwise
 * leaves the account's existing balance alone, on the assumption that
 * `balanceBefore` already covers whatever the caller needs (grants and
 * burns are on separate caps — a capped-out account can still check out
 * and dispute freely). Returns how much it actually added, so a caller can
 * compute `balanceBefore + actuallyGranted` instead of re-reading balance.
 */
export async function grantPointsBestEffort(
  userId: string,
  points: number,
  balanceBefore: number,
  minimumBalance: number,
): Promise<number> {
  try {
    await grantPoints(userId, points);
    return points;
  } catch (error) {
    if (!String(error).includes("velocity_capped")) throw error;
    expect(
      balanceBefore,
      "no earn-cap room left today and no existing balance to fall back on",
    ).toBeGreaterThanOrEqual(minimumBalance);
    return 0;
  }
}

/**
 * Runs a real `quote` + `checkout` for `listingId`, returning the minted
 * voucher id and its locked price. `authHeaders` is whichever the caller
 * has on hand — a browser session's `{ cookie }` (`b-wallet-voucher.spec.ts`,
 * which logs in through the real page) or a bare `{ authorization: "Bearer
 * <token>" }` (`offline-voucher-detail.spec.ts`, which seeds entirely
 * through `request` in `beforeAll`, before any page exists) — `apiFetch`'s
 * own auth guard reads either.
 */
export async function checkoutListing(
  request: APIRequestContext,
  authHeaders: Record<string, string>,
  listingId: string,
): Promise<{ voucherId: string; pricePoints: number }> {
  const quoted = await request.post(`${apiBaseUrl()}/api/checkout/quote`, {
    headers: authHeaders,
    data: { listingId },
  });
  expect(quoted.ok(), `quote failed: ${await quoted.text()}`).toBeTruthy();
  const quote = (await quoted.json()) as { checkoutId: string; pricePoints: number };

  const checkedOut = await request.post(`${apiBaseUrl()}/api/checkout`, {
    headers: { ...authHeaders, "idempotency-key": randomUUID() },
    data: { checkoutId: quote.checkoutId },
  });
  expect(checkedOut.ok(), `checkout failed: ${await checkedOut.text()}`).toBeTruthy();
  const result = (await checkedOut.json()) as { voucherId: string; state: string };
  expect(result.state).toBe("done");
  return { voucherId: result.voucherId, pricePoints: quote.pricePoints };
}
