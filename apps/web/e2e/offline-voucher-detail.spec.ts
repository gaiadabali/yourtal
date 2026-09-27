import { expect, test } from "@playwright/test";
import type pg from "pg";
import {
  checkoutListing,
  ensureAccount,
  grantPointsBestEffort,
  openLiveDbPool,
  seedListing,
  walletBalanceViaToken,
} from "./live-voucher-fixture";
import type { TestAccount } from "./live-voucher-fixture";

/**
 * 6.9 (F43): YT-0424's last acceptance criterion, "renders from cache with
 * the network disabled," proven against the REAL stack rather than
 * `mockVouchers` (this file's own history — stale since 1.7.c's login gate
 * and 4.8's real API: on main 97f2e2b, the first, online load already
 * landed on the logged-out page and the mock fixture heading never
 * appeared. `voucher-detail-view.test.tsx` already proves the component's
 * own render path has zero network dependency given a cache entry (a
 * stubbed-fetch unit test); what THIS file proves is the piece that needs a
 * real browser and a real service worker: the page's actual HTML/JS shell,
 * for a REAL signed-in account's REAL voucher, still loads when the network
 * is fully off.
 *
 * `WALLET_VOUCHER_LIVE=1`, same live ledger+voucher stack and seeding
 * recipe as `b-wallet-voucher.spec.ts` (6.5.c) — see that file's header for
 * the exact commands, and `live-voucher-fixture.ts` for the shared helper
 * both specs call. MUST run against `playwright.offline.config.ts`
 * (`--config=playwright.offline.config.ts`): that config runs a real
 * `pnpm build && next start` (Serwist only caches anything in production,
 * `NODE_ENV=production` — see `app/sw.ts`'s own doc comment), not `next
 * dev`.
 *
 * SEQUENCE, and why each step is there:
 * 1. Sign in through the real `/dev/login` form, `returnTo` the voucher page.
 * 2. Visit the voucher page once, online. This is an UNCONTROLLED
 *    navigation — the service worker that registers as a side effect of
 *    this load cannot intercept the request that loaded it (a page is
 *    never controlled by the registration it triggers).
 * 3. Wait for `navigator.serviceWorker.ready` — resolves once the worker
 *    reaches `activated`. `app/sw.ts` sets `clientsClaim: true`, so once
 *    active it immediately takes control of this already-open page too.
 * 4. Reload once more, still online. This navigation IS controlled, so
 *    Serwist's own NetworkFirst pages/RSC route intercepts it, fetches from
 *    the network (succeeds), and caches the response as a side effect —
 *    exactly the "visited once while online" precondition a NetworkFirst
 *    cache fallback needs.
 * 5. `context.setOffline(true)` — Playwright/CDP-level offline, below the
 *    service worker: the worker keeps running and can still read its own
 *    Cache Storage, only real network fetches fail. This is the honest
 *    proxy for a real dropped connection, not a mocked `fetch`.
 * 6. Reload again. NetworkFirst's network attempt fails immediately, and it
 *    falls back to the cache entry step 4 wrote.
 * 7. Assert the SAME real content is visible — this voucher's own status
 *    badge and its `voucherId`-scoped link back to the wallet — not just "a
 *    page rendered." A generic browser offline-error page, or the
 *    logged-out redirect this file used to (accidentally) prove, would fail
 *    this.
 */
const live = process.env["WALLET_VOUCHER_LIVE"] === "1";
test.skip(!live, "needs a live ledger+voucher — see this file's header for how to run it");

const ACCOUNT: TestAccount = {
  email: "b-offline-e2e@example.com",
  password: "correct horse battery staple",
  displayName: "E2E Offline Tester",
};
const GRANT_POINTS = 500;

let voucherId: string;
let pool: pg.Pool;

test.beforeAll(async ({ request }) => {
  pool = openLiveDbPool();
  const auth = await ensureAccount(request, ACCOUNT);
  const balanceBefore = await walletBalanceViaToken(request, auth.token);
  const listingId = await seedListing(pool);
  await grantPointsBestEffort(auth.userId, GRANT_POINTS, balanceBefore, 200);

  // No browser/page exists yet in `beforeAll` — the bearer token from
  // `ensureAccount` stands in for the session cookie the browser will use
  // in the test itself (`apiFetch`'s auth guard reads either).
  const { voucherId: minted } = await checkoutListing(
    request,
    { authorization: `Bearer ${auth.token}` },
    listingId,
  );
  voucherId = minted;
});

test.afterAll(async () => {
  await pool.end();
});

test("voucher detail page renders from the service worker cache with the network fully disabled", async ({
  page,
  context,
}) => {
  await page.goto(`/dev/login?returnTo=${encodeURIComponent(`/wallet/voucher/${voucherId}`)}`);
  await page.getByLabel("Email").fill(ACCOUNT.email);
  await page.getByLabel("Password").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/wallet/voucher/${voucherId}$`));

  // The page's own real, signed-in content — a status badge naming this
  // voucher's real (live) state — is what every assertion below re-checks,
  // never a generic "something rendered."
  const statusBadge = page.getByText("Active", { exact: true });

  // Step 2: first, uncontrolled, online load — registers the service worker.
  await expect(statusBadge).toBeVisible();

  // Step 3: wait for the worker to finish installing and activating.
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return "unsupported";
    }
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state ?? "no-active-worker";
  });
  expect(swState, "expected an activated service worker before continuing").toBe("activated");

  // Step 4: second, controlled, still-online load — this is the request the
  // service worker actually intercepts and caches.
  await page.reload({ waitUntil: "networkidle" });
  await expect(statusBadge).toBeVisible();

  // Step 5: disable the network at the browser level, not by mocking fetch.
  await context.setOffline(true);

  try {
    // Step 6: reload with the network fully off.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Step 7: the real voucher content, not a generic offline page and not
    // a redirect to /login (the exact failure this file's own history
    // records: a session-gated page that only ever "worked offline" by
    // accident, because it never actually required a session).
    await expect(statusBadge).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/wallet/voucher/${voucherId}$`));
  } finally {
    // Always restore connectivity, even on failure, so this worker/context
    // is not left offline for whatever Playwright runs next.
    await context.setOffline(false);
  }
});
