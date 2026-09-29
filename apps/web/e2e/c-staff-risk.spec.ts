import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * TASKS.md 10.5.a's Check, live: a staff `risk_analyst` opens `/staff/risk`,
 * sees why a flagged account was flagged, releases it through the required-
 * reason dialog, and it leaves the queue. Also proves a suspend and the
 * `support` role's 403. Screenshots at 390 and 1280 px, light and dark, each
 * axe-checked. `LEDGER_MODE=fake` in this slot -- the fake ledger never runs
 * the real Go RiskGate (10.4), so this seeds `platform.ledger_fake_risk_flag`
 * directly, the same recipe `staff-risk-queue.e2e.test.ts` uses.
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
  readonly token: string;
}

async function registerAndLogIn(request: APIRequestContext, tag: string): Promise<LiveAccount> {
  const email = `c-staff-risk-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-risk-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: `Staff Risk E2E ${tag}`,
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const body = (await registered.json()) as { token: string };
  return { email, token: body.token };
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

function dbPool(): Pool {
  const url = process.env["DATABASE_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return new Pool({ connectionString: url });
}

/** Same recipe `staff-risk-queue.e2e.test.ts` uses: a "block" severity flag with an auto-held escrow. */
async function seedBlockedFlag(
  pool: Pool,
  tag: string,
): Promise<{ flagId: string; escrowId: string; userId: string }> {
  const userId = randomUUID();
  const escrowId = `esc_${randomUUID()}`;
  await pool.query(
    `INSERT INTO platform.ledger_fake_escrow (id, user_id, points, pending_points, reason, state)
     VALUES ($1, $2, 130, 0, 'risk: velocity_user', 'held')`,
    [escrowId, userId],
  );
  const flag = await pool.query<{ id: string }>(
    `INSERT INTO platform.ledger_fake_risk_flag (user_id, region, severity, reason, signals, escrow_id, status)
     VALUES ($1, 'AU', 'block', 'velocity_user', $2::jsonb, $3, 'pending')
     RETURNING id`,
    [
      userId,
      JSON.stringify([{ kind: "velocity_user", detail: `${tag}: 10 grants in 10m` }]),
      escrowId,
    ],
  );
  const flagId = flag.rows[0]?.id;
  if (flagId === undefined) throw new Error("failed to seed a fake risk flag");
  return { flagId, escrowId, userId };
}

/** A "flag" severity with no escrow -- nothing was auto-held. */
async function seedFlaggedOnly(
  pool: Pool,
  tag: string,
): Promise<{ flagId: string; userId: string }> {
  const userId = randomUUID();
  const flag = await pool.query<{ id: string }>(
    `INSERT INTO platform.ledger_fake_risk_flag (user_id, region, severity, reason, signals, status)
     VALUES ($1, 'AU', 'flag', 'timing_implausible', $2::jsonb, 'pending')
     RETURNING id`,
    [userId, JSON.stringify([{ kind: "timing_implausible", detail: `${tag}: answered too fast` }])],
  );
  const flagId = flag.rows[0]?.id;
  if (flagId === undefined) throw new Error("failed to seed a fake risk flag");
  return { flagId, userId };
}

test.describe.serial("10.5.a: the risk queue screen", () => {
  let riskAnalyst: LiveAccount;
  let support: LiveAccount;
  let pool: Pool;

  test.beforeAll(async ({ request }) => {
    pool = dbPool();
    riskAnalyst = await registerAndLogIn(request, "analyst");
    staffAdd(riskAnalyst.email, "risk_analyst");
    support = await registerAndLogIn(request, "support");
    staffAdd(support.email, "support");
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("a risk_analyst sees why an account was flagged, releases it, and it leaves the queue", async ({
    browser,
    baseURL,
  }) => {
    const { flagId, escrowId, userId } = await seedBlockedFlag(pool, "release");
    const page = await pageAs(browser, baseURL as string, riskAnalyst.token);
    await page.goto("/staff/risk?region=AU");
    await expect(page.getByRole("heading", { level: 1, name: "Risk queue" })).toBeVisible();

    // The queue shows the RiskGate's own reason and signal, not a trust tier.
    await expect(page.getByText(userId).first()).toBeVisible();
    await expect(page.getByText("velocity_user").first()).toBeVisible();
    await expect(page.getByText("release: 10 grants in 10m").first()).toBeVisible();
    await expect(page.getByText("Trust tier")).toHaveCount(0);

    await page.getByRole("button", { name: "Release" }).click();
    await page
      .getByRole("textbox", { name: "Reason" })
      .fill("false positive -- shared wifi, e2e check");
    await page.getByRole("dialog").getByRole("button", { name: "Release" }).click();

    await expect(page.getByText(userId)).toHaveCount(0);
    await expectAxeClean(page);

    const flagRow = await pool.query<{ status: string }>(
      `SELECT status FROM platform.ledger_fake_risk_flag WHERE id = $1`,
      [flagId],
    );
    expect(flagRow.rows[0]?.status).toBe("released");
    const escrowRow = await pool.query<{ state: string }>(
      `SELECT state FROM platform.ledger_fake_escrow WHERE id = $1`,
      [escrowId],
    );
    expect(escrowRow.rows[0]?.state).toBe("released");

    await page.context().close();
  });

  test("a risk_analyst suspends a flagged account into escrow, and it leaves the queue", async ({
    browser,
    baseURL,
  }) => {
    const { flagId, userId } = await seedFlaggedOnly(pool, "suspend");
    const page = await pageAs(browser, baseURL as string, riskAnalyst.token);
    await page.goto("/staff/risk?region=AU");
    await expect(page.getByText(userId).first()).toBeVisible();

    await page.getByRole("button", { name: "Suspend into escrow" }).click();
    await page
      .getByRole("textbox", { name: "Reason" })
      .fill("confirmed farming after review -- e2e check");
    await page.getByRole("dialog").getByRole("button", { name: "Suspend into escrow" }).click();

    await expect(page.getByText(userId)).toHaveCount(0);

    const flagRow = await pool.query<{ status: string }>(
      `SELECT status FROM platform.ledger_fake_risk_flag WHERE id = $1`,
      [flagId],
    );
    expect(flagRow.rows[0]?.status).toBe("suspended");

    await page.context().close();
  });

  test("support does not see the risk zone; opening it directly is refused", async ({
    browser,
    baseURL,
  }) => {
    const page = await pageAs(browser, baseURL as string, support.token);
    await expect(page.getByRole("link", { name: "Risk" })).toHaveCount(0);
    const response = await page.goto("/staff/risk?region=AU");
    expect(response?.status()).toBe(403);
    await page.context().close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`risk queue screen at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        await seedBlockedFlag(pool, `shot-${String(width)}-${colorScheme}`);
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([
          { name: "yt_session", value: riskAnalyst.token, url: baseURL as string },
        ]);
        const page = await context.newPage();
        await page.goto("/staff/risk?region=AU");
        await expect(page.getByRole("heading", { level: 1, name: "Risk queue" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-risk-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
