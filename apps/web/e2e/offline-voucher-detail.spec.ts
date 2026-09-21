import { expect, test } from "@playwright/test";
import { mockVouchers } from "@yourtal/contracts/voucher/mock";

/**
 * Any genuinely active, unexpired voucher proves the seam this file exists
 * to check — nothing here depends on WHICH one. Same selection rule as
 * `wallet-merchant-qr-agreement.spec.ts`, so a change to the voucher
 * generator's draw order can never invalidate this test the way a pinned
 * id could.
 */
function findWalletVoucherFixture() {
  const now = Date.now();
  const voucher = mockVouchers.find(
    (candidate) => candidate.status === "active" && new Date(candidate.expiresAt).getTime() > now,
  );
  if (!voucher) {
    throw new Error(
      "expected at least one active, unexpired voucher in mockVouchers — the wallet itself would have nothing to show either",
    );
  }
  return voucher;
}

/**
 * YT-0424's last acceptance criterion: "renders from cache with the
 * network disabled." `voucher-detail-view.test.tsx` already proves the
 * component's own render path has zero network dependency given a cache
 * entry (a stubbed-fetch unit test); what THIS file proves is the piece
 * that needs a real browser and a real service worker: the page's actual
 * HTML/JS shell still loads when the network is fully off, not just the
 * data inside it.
 *
 * MUST run against `playwright.offline.config.ts`
 * (`--config=playwright.offline.config.ts`), not the main config — see
 * that file's own doc comment for why: this app's default `next build`
 * (Turbopack) never emits `public/sw.js` at all (a real, silent Serwist ×
 * Turbopack incompatibility found in this ticket, not a hypothetical),
 * so only a `next build --webpack` run has a working service worker to
 * test against.
 *
 * SEQUENCE, and why each step is there:
 * 1. Visit the voucher page once, online. This is an UNCONTROLLED
 *    navigation — the service worker that registers as a side effect of
 *    this load cannot intercept the request that loaded it (a page is
 *    never controlled by the registration it triggers).
 * 2. Wait for `navigator.serviceWorker.ready` — resolves once the worker
 *    reaches `activated`. `app/sw.ts` sets `clientsClaim: true`, so once
 *    active it immediately takes control of this already-open page too.
 * 3. Reload once more, still online. This navigation IS controlled, so
 *    Serwist's own NetworkFirst pages/others route (`@serwist/next`'s
 *    `defaultCache`) intercepts it, fetches from the network (succeeds),
 *    and caches the response as a side effect — exactly the "visited once
 *    while online" precondition a NetworkFirst cache fallback needs.
 * 4. `context.setOffline(true)` — Playwright/CDP-level offline, below the
 *    service worker: the worker keeps running and can still read its own
 *    Cache Storage, only real network fetches fail. This is the honest
 *    proxy for a real dropped connection, not a mocked `fetch`.
 * 5. Reload again. NetworkFirst's network attempt fails immediately, and
 *    it falls back to the cache entry step 3 wrote.
 * 6. Assert the SAME real content is visible — the voucher's actual
 *    merchant name and title — not just "a page rendered." A generic
 *    browser offline-error page or an empty shell would fail this.
 */
test("voucher detail page renders from the service worker cache with the network fully disabled", async ({
  page,
  context,
}) => {
  const voucher = findWalletVoucherFixture();
  const url = `/wallet/voucher/${voucher.id}`;

  // `voucher.merchantName` legitimately appears more than once on this page
  // (the header eyebrow and the redemption-instructions paragraph both name
  // it), so every assertion below checks the one element that uniquely
  // identifies the page: the `<h1>`, which renders `voucher.title` verbatim.
  const heading = page.getByRole("heading", { name: voucher.title });

  // Step 1: first, uncontrolled, online load — registers the service worker.
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(heading).toBeVisible();

  // Step 2: wait for the worker to finish installing and activating.
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return "unsupported";
    }
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state ?? "no-active-worker";
  });
  expect(swState, "expected an activated service worker before continuing").toBe("activated");

  // Step 3: second, controlled, still-online load — this is the request
  // the service worker actually intercepts and caches.
  await page.reload({ waitUntil: "networkidle" });
  await expect(heading).toBeVisible();

  // Step 4: disable the network at the browser level, not by mocking fetch.
  await context.setOffline(true);

  try {
    // Step 5: reload with the network fully off.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Step 6: the real voucher content, not a generic offline page.
    await expect(heading).toBeVisible();
    await expect(page.getByText(voucher.merchantName).first()).toBeVisible();
  } finally {
    // Always restore connectivity, even on failure, so this worker/context
    // is not left offline for whatever Playwright runs next.
    await context.setOffline(false);
  }
});
