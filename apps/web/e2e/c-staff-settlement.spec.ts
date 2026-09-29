import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import pg from "pg";

/**
 * TASKS.md 10.6.c's Check, over a live api + web on this slot: an approved
 * statement produces exactly one simulated payout after the dispute window,
 * and a disputed one pays nothing until resolved. Screenshots at 390 and
 * 1280 px, light and dark, each axe-checked.
 *
 * `staff-settlement.e2e.test.ts` (apps/api) proves the same invariants at
 * the HTTP+DB layer, including the two-person self-approval refusal; this
 * spec proves the actual staff console screen a person uses, the way
 * `c-staff-economy.spec.ts` does for 9.5.
 *
 * There is no HTTP route that GENERATES a statement (10.1.b: only apps/
 * worker's weekly job does, or `generateStatementFake` in a Vitest process)
 * -- this spec writes its own statement fixtures directly into
 * `platform.ledger_fake_statement` (`LEDGER_MODE=fake`'s own table) with a
 * raw `pg` pool, the same "no HTTP path for this fixture" pattern
 * `live-voucher-fixture.ts` already uses for its own live-stack specs.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DISPUTE_WINDOW_DAYS = 7;

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

function ownerDbUrl(): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

interface LiveAccount {
  readonly email: string;
  readonly token: string;
}

async function registerAndLogIn(request: APIRequestContext, tag: string): Promise<LiveAccount> {
  const email = `c-staff-settle-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Settlement E2E",
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const loggedIn = await request.post(`${apiBaseUrl()}/api/auth/login`, {
    data: { email, password },
  });
  expect(loggedIn.ok(), await loggedIn.text()).toBeTruthy();
  const body = (await loggedIn.json()) as { token: string };
  return { email, token: body.token };
}

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

/** A real AU business, created through the real API, for the fixture statement's own `business_id`. */
async function createBusiness(request: APIRequestContext, owner: LiveAccount): Promise<string> {
  const handle = `c-staff-settle-biz-${Date.now()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      legalName: "Staff Settlement E2E Pty Ltd",
      displayName: "Staff Settlement E2E Co",
      taxIdKind: "ABN",
      taxIdValue: "12345678902",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser"],
      region: "AU",
      handle,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { business: { id: string } };
  return body.business.id;
}

/**
 * A statement fixture written directly to `platform.ledger_fake_statement`
 * (LEDGER_MODE=fake's own table, migration 20260929070700), with its dispute
 * window already closed (`periodTo` 8 days ago) and a real, positive closing
 * payable, so a payout on it is a genuine amount, not an empty zero-value row.
 */
async function insertStatement(
  pool: pg.Pool,
  businessId: string,
  status: "open" | "disputed",
): Promise<string> {
  const id = `stmt_e2e_${crypto.randomUUID()}`;
  const periodTo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const periodFrom = new Date(periodTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  const disputeWindowEndsAt = new Date(
    periodTo.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  await pool.query(
    `INSERT INTO platform.ledger_fake_statement
       (id, business_id, region, currency, period_from, period_to,
        opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
        closing_payable_minor, dispute_window_ends_at, status, dispute_reason, disputed_at)
     VALUES ($1, $2, 'AU', 'AUD', $3, $4, 0, 420000, 0, 0, 420000, $5, $6, $7, $8)`,
    [
      id,
      businessId,
      periodFrom.toISOString(),
      periodTo.toISOString(),
      disputeWindowEndsAt.toISOString(),
      status,
      status === "disputed" ? "amount looks wrong" : null,
      status === "disputed" ? new Date().toISOString() : null,
    ],
  );
  return id;
}

test.describe.serial("10.6.a/10.6.c: staff settlement console", () => {
  let financeA: LiveAccount;
  let financeB: LiveAccount;
  let ops: LiveAccount;
  let businessId: string;
  let pool: pg.Pool;

  test.beforeAll(async ({ request }) => {
    pool = new pg.Pool({ connectionString: ownerDbUrl() });
    financeA = await registerAndLogIn(request, "finance-a");
    financeB = await registerAndLogIn(request, "finance-b");
    ops = await registerAndLogIn(request, "ops");
    const owner = await registerAndLogIn(request, "owner");
    staffAdd(financeA.email, "finance");
    staffAdd(financeB.email, "finance");
    staffAdd(ops.email, "ops");
    businessId = await createBusiness(request, owner);
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("an approved statement produces exactly one simulated payout, after a second approver", async ({
    browser,
    baseURL,
  }) => {
    await insertStatement(pool, businessId, "open");

    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/settlement?region=AU");
    await expect(pageA.getByRole("heading", { level: 1, name: "Settlement" })).toBeVisible();
    await expect(pageA.getByText(businessId).first()).toBeVisible();

    const row = pageA.getByRole("row", { name: new RegExp(businessId) });
    await row.getByRole("button", { name: "Propose payout" }).click();
    await expect(
      pageA.getByText("The payout was proposed and is awaiting a second approver."),
    ).toBeVisible();
    await expect(pageA.getByText("Awaiting a second approver").first()).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/settlement?region=AU");
    await pageB
      .getByRole("row", { name: new RegExp(businessId) })
      .getByRole("button", { name: "Approve payout" })
      .click();
    await expect(pageB.getByText("The payout was approved.")).toBeVisible();
    // Paid statements leave the open/disputed queue -- exactly one payout,
    // never a row that can be approved a second time.
    await expect(pageB.getByText(businessId)).toHaveCount(0);
    await pageB.close();
  });

  test("a disputed statement pays nothing until resolved, then pays out once resolved", async ({
    browser,
    baseURL,
  }) => {
    await insertStatement(pool, businessId, "disputed");

    const pageOps = await pageAs(browser, baseURL as string, ops.token);
    await pageOps.goto("/staff/settlement?region=AU");
    const row = pageOps.getByRole("row", { name: new RegExp(businessId) });
    await expect(row.getByText("Disputed")).toBeVisible();
    // A disputed row offers no payout action at all -- only resolve.
    await expect(row.getByRole("button", { name: "Propose payout" })).toHaveCount(0);

    await row.getByLabel("Resolution note (required)").fill("recovery posted, dispute unfounded");
    await row.getByRole("button", { name: "Resolve dispute" }).click();
    await expect(pageOps.getByText("The dispute was resolved. The statement is open again.")).toBeVisible();
    await pageOps.close();

    // Now open (and its window was already closed) -- the normal two-person payout works.
    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/settlement?region=AU");
    await pageA
      .getByRole("row", { name: new RegExp(businessId) })
      .getByRole("button", { name: "Propose payout" })
      .click();
    await expect(
      pageA.getByText("The payout was proposed and is awaiting a second approver."),
    ).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/settlement?region=AU");
    await pageB
      .getByRole("row", { name: new RegExp(businessId) })
      .getByRole("button", { name: "Approve payout" })
      .click();
    await expect(pageB.getByText("The payout was approved.")).toBeVisible();
    await pageB.close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`queue at ${String(width)}px, ${colorScheme}`, async ({ browser, baseURL }) => {
        await insertStatement(pool, businessId, "open");
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
        await context.addCookies([
          { name: "yt_session", value: financeA.token, url: baseURL as string },
        ]);
        const page = await context.newPage();
        const response = await page.goto("/staff/settlement?region=AU");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Settlement" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-settlement-queue-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
