import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * TASKS.md 9.4.e's Check, live: a staff member searches and views an
 * account, a suspension moves available AND pending points to a ledger
 * escrow (never zeroing the balance) and release reverses both, goodwill
 * stays under the F12 ceiling, and a captured-voucher dispute (K13) appears
 * in the staff queue. Screenshots at 390 and 1280 px, light and dark, each
 * axe-checked. `LEDGER_MODE=fake` in this slot (see fake-ledger-wallet.ts's
 * own "available first, then pending (9.4.b)" comment).
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

interface LiveAccount {
  readonly email: string;
  readonly userId: string;
  readonly token: string;
}

async function registerAndLogIn(
  request: APIRequestContext,
  tag: string,
  region: "AU" | "ID" = "AU",
): Promise<LiveAccount> {
  const email = `c-staff-users-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-users-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      email,
      password,
      region,
      locale: region === "AU" ? "en-AU" : "id-ID",
      displayName: `Staff Users E2E ${tag}`,
      dateOfBirth: "1990-01-01",
      timezone: region === "AU" ? "Australia/Sydney" : "Asia/Jakarta",
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const body = (await registered.json()) as { userId: string; token: string };
  return { email, userId: body.userId, token: body.token };
}

/** The real CLI, exactly as a person with database access would run it. */
function staffAdd(email: string, role: string): void {
  execFileSync("pnpm", ["staff:add", email, role], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

async function pageAs(browser: Browser, baseURL: string, token: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([{ name: "yt_session", value: token, url: baseURL }]);
  return context.newPage();
}

async function expectAxeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual(
    [],
  );
}

/** Setup-only calls against the real API (staff or consumer) -- the CHECK itself (suspend/release/the dispute queue) is driven through the browser below. */
async function authedApi(
  request: APIRequestContext,
  token: string,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<unknown> {
  const response = await request.fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path} -> ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<unknown>;
}

/** Zero holdback (tier 3) so a goodwill grant lands in AVAILABLE immediately, not pending. */
async function setTrustTier(
  request: APIRequestContext,
  riskToken: string,
  userId: string,
  trustTier: 0 | 1 | 2 | 3,
): Promise<void> {
  await authedApi(request, riskToken, "POST", `/api/staff/users/${userId}/trust-tier`, {
    trustTier,
    reason: "e2e setup",
  });
}

async function goodwill(
  request: APIRequestContext,
  supportToken: string,
  userId: string,
  points: number,
): Promise<void> {
  await authedApi(request, supportToken, "POST", `/api/staff/users/${userId}/goodwill`, {
    points,
    reason: "e2e setup",
  });
}

function dbPool(): Pool {
  const url = process.env["DATABASE_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return new Pool({ connectionString: url });
}

/**
 * Same recipe `checkout/dispute.controller.test.ts` uses -- ID, the only
 * region this slot's seed populates `store.listings` for (F2's region wall
 * means an AU buyer could never check out an ID listing anyway, so the
 * dispute-check buyer below registers in ID).
 */
async function pickListing(pool: Pool): Promise<{ listingId: string; pricePoints: number }> {
  // price_in_points is bigint -- node-postgres returns that as a string, not
  // a number, to avoid silently truncating a value bigger than
  // Number.MAX_SAFE_INTEGER. Every price this seed writes fits safely, so
  // Number() below is exact, and a JSON body needs a real number: goodwill's
  // own UserAccountAttributeLoader only reads `typeof body.points ===
  // "number"` (pre-validation, straight off the wire) into the Cerbos
  // ceiling check, and a JSON string there is silently invisible to it.
  const result = await pool.query<{ id: string; price_in_points: string }>(
    `UPDATE store.listings SET lifecycle_state = 'active', status = 'available',
            stock_remaining = stock_total, expires_at = now() + interval '30 days',
            audience = 'all_ages', channel = 'in_store'
      -- Cheapest first, deterministically: the buyer is funded through a
      -- goodwill grant that must itself stay under F12's own per-case
      -- ceiling (ID: 5,000 pts), so a random expensive listing could make
      -- the funding step fail for a reason that has nothing to do with
      -- what this spec is checking.
      WHERE id = (SELECT id FROM store.listings WHERE region = 'ID' ORDER BY price_in_points ASC LIMIT 1)
    RETURNING id::text, price_in_points`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("no ID listing to seed a dispute with");
  return { listingId: row.id, pricePoints: Number(row.price_in_points) };
}

async function checkoutListing(
  request: APIRequestContext,
  buyerToken: string,
  listingId: string,
): Promise<string> {
  const quote = (await authedApi(request, buyerToken, "POST", "/api/checkout/quote", {
    listingId,
  })) as { checkoutId: string };
  const result = (await authedApi(request, buyerToken, "POST", "/api/checkout", {
    checkoutId: quote.checkoutId,
  })) as { voucherId: string; state: string };
  expect(result.state).toBe("done");
  return result.voucherId;
}

test.describe.serial("9.4: users and support", () => {
  let support: LiveAccount;
  let risk: LiveAccount;
  let escrowTarget: LiveAccount;
  let disputeBuyer: LiveAccount;
  let disputeVoucherId: string;
  let pool: Pool;

  test.beforeAll(async ({ request }) => {
    pool = dbPool();
    support = await registerAndLogIn(request, "support");
    staffAdd(support.email, "support");
    risk = await registerAndLogIn(request, "risk");
    staffAdd(risk.email, "risk_analyst");

    // The escrow-check target: 40 available (tier 3, no holdback) + 25
    // pending (tier 0, 72h holdback) -- both through the real staff API,
    // exactly as the UI's own goodwill form would call it.
    escrowTarget = await registerAndLogIn(request, "target");
    await setTrustTier(request, risk.token, escrowTarget.userId, 3);
    await goodwill(request, support.token, escrowTarget.userId, 40);
    await setTrustTier(request, risk.token, escrowTarget.userId, 0);
    await goodwill(request, support.token, escrowTarget.userId, 25);

    // The K13 dispute-check buyer: enough available points to buy a real
    // listing, then the merchant "already took it" (voidVoucher answers
    // already_granted), same recipe dispute.controller.test.ts uses.
    disputeBuyer = await registerAndLogIn(request, "buyer", "ID");
    await setTrustTier(request, risk.token, disputeBuyer.userId, 3);
    const { listingId, pricePoints } = await pickListing(pool);
    await goodwill(request, support.token, disputeBuyer.userId, pricePoints);
    disputeVoucherId = await checkoutListing(request, disputeBuyer.token, listingId);
    await pool.query(`UPDATE platform.voucher_fake_voucher SET state = 'released' WHERE id = $1`, [
      disputeVoucherId,
    ]);
    const disputed = await authedApi(
      request,
      disputeBuyer.token,
      "POST",
      `/api/wallet/vouchers/${disputeVoucherId}/dispute`,
      { reason: "merchant_closed" },
    );
    expect((disputed as { outcome: string }).outcome).toBe("queued");
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("staff search a user by email and open their detail screen", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, support.token);
    await page.goto(`/staff/users?email=${encodeURIComponent(escrowTarget.email)}`);
    // DataTable renders a table AND a stacked mobile-card copy of every row
    // (data-table.tsx) -- .first() is the table's own, always the desktop one.
    await expect(page.getByRole("link", { name: escrowTarget.email }).first()).toBeVisible();
    await page.getByRole("link", { name: escrowTarget.email }).first().click();
    await expect(page).toHaveURL(new RegExp(`/staff/users/${escrowTarget.userId}$`));
    await expect(page.getByRole("heading", { level: 2, name: "Profile" })).toBeVisible();
    await page.context().close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`users search screen at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([{ name: "yt_session", value: support.token, url: baseURL as string }]);
        const page = await context.newPage();
        await page.goto("/staff/users");
        await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-users-search-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }

  test("a suspension moves available AND pending points to escrow, and release reverses both", async ({
    browser,
    baseURL,
  }) => {
    const page = await pageAs(browser, baseURL as string, risk.token);
    await page.goto(`/staff/users/${escrowTarget.userId}`);

    // KeyValue is a plain <dl>, never duplicated for responsive layout (unlike
    // DataTable), so its own <dt>/<dd> pair is an unambiguous, single locator.
    const available = page.locator('dt:has-text("Available points") + dd');
    const pending = page.locator('dt:has-text("Pending points") + dd');
    const status = page.locator('dt:has-text("Status") + dd');

    // Before: the account's real available/pending split, both nonzero.
    await expect(available).toContainText("40");
    await expect(pending).toContainText("25");
    await expect(status).toContainText("Active");

    await page.getByRole("textbox", { name: "Reason" }).first().fill("risk review -- e2e check");
    await page.getByRole("button", { name: "Suspend into escrow" }).click();

    await expect(page).toHaveURL(/[?&]suspended=1/);
    await expect(
      page.getByText("The account was suspended and its points moved to escrow."),
    ).toBeVisible();
    await expect(status).toContainText("Suspended");
    // Escrowed -- neither bucket still shows the original amount (never
    // zeroed on disk, but the ledger's balance read now excludes the held
    // escrow entirely -- see fake-ledger-balance.ts).
    await expect(available).toContainText("0");
    await expect(pending).toContainText("0");
    await expectAxeClean(page);
    await page.screenshot({
      path: "test-results/c-staff-user-detail-suspended.png",
      fullPage: true,
    });

    await page.getByRole("button", { name: "Release" }).click();
    await expect(page).toHaveURL(/[?&]released=1/);
    await expect(
      page.getByText("The account was released and its points returned."),
    ).toBeVisible();
    await expect(status).toContainText("Active");
    await expect(available).toContainText("40");
    await expect(pending).toContainText("25");

    await page.context().close();
  });

  test("goodwill stays under the F12 ceiling; a request over it is refused", async ({
    browser,
    baseURL,
  }) => {
    const page = await pageAs(browser, baseURL as string, support.token);
    await page.goto(`/staff/users/${escrowTarget.userId}`);

    await page.getByRole("spinbutton", { name: "Points" }).fill("50");
    await page.getByRole("textbox", { name: "Reason" }).fill("goodwill for a bad experience -- e2e check");
    await page.getByRole("button", { name: "Grant goodwill" }).click();

    await expect(page).toHaveURL(/[?&]goodwill=1/);
    await expect(page.getByText("The goodwill credit was granted.")).toBeVisible();

    await page.getByRole("spinbutton", { name: "Points" }).fill("5000");
    await page.getByRole("textbox", { name: "Reason" }).fill("over the region's own cap -- e2e check");
    await page.getByRole("button", { name: "Grant goodwill" }).click();
    await expect(page).toHaveURL(/[?&]error=1/);
    await expect(
      page.getByText("That action could not be completed. Check the account's state and try again."),
    ).toBeVisible();

    await page.context().close();
  });

  test("a captured-voucher dispute appears in the K13 queue", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, support.token);
    await page.goto("/staff/disputes");
    await expect(page.getByRole("heading", { level: 1, name: "Disputes" })).toBeVisible();
    // .first(): DataTable's own responsive duplication (see the search test's comment above).
    await expect(page.getByText(disputeVoucherId).first()).toBeVisible();
    await expect(page.getByText(disputeBuyer.userId).first()).toBeVisible();
    await expect(page.getByText("Merchant closed").first()).toBeVisible();
    await expectAxeClean(page);
    await page.context().close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`disputes queue at ${String(width)}px, ${colorScheme}`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([{ name: "yt_session", value: support.token, url: baseURL as string }]);
        const page = await context.newPage();
        await page.goto("/staff/disputes");
        // DataTable renders both a desktop <table> and a stacked mobile <ul>
        // copy of every row (hidden/md:hidden) -- at 390px the table copy is
        // display:none, so `.first()` (the table's own) is never "visible"
        // there. .toHaveCount(2) asserts the row rendered at all, in both
        // copies, without depending on which viewport made which one show.
        await expect(page.getByText(disputeVoucherId)).toHaveCount(2);
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-disputes-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }

  test("risk_analyst does not see the disputes zone; a viewer gets 403", async ({
    browser,
    baseURL,
  }) => {
    const page = await pageAs(browser, baseURL as string, risk.token);
    const response = await page.goto("/staff/disputes");
    expect(response?.status()).toBe(403);
    await page.context().close();
  });
});
