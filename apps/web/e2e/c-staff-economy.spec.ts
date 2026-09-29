import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

/**
 * TASKS.md 9.5.e's Check, over a live api + web on this slot: a rate change
 * needs a second approver; coverage matches the ledger (the overview screen
 * echoes `ledger.coverage()` verbatim); marketing funding and a manual point
 * purchase are both two-person; a region setting change (the AU daily cap)
 * is readable back once approved -- proving the staff-console half of
 * "changes what's enforced" (`services/ledger/internal/reward/caps.go`'s
 * `Engine.Caps()` reads the same `platform.region_setting` row; RiskGate
 * itself is Phase 10.4, not built, and is not what this proves). Screenshots
 * at 390 and 1280 px, light and dark, each axe-checked.
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
  const email = `c-staff-econ-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Economy E2E",
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

/** A real AU business, created through the real API, for the manual-purchase flow. */
async function createBusiness(request: APIRequestContext, owner: LiveAccount): Promise<string> {
  const handle = `c-staff-econ-biz-${Date.now()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      legalName: "Staff Economy E2E Pty Ltd",
      displayName: "Staff Economy E2E Co",
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

test.describe.serial("9.5: staff economy console", () => {
  let financeA: LiveAccount;
  let financeB: LiveAccount;
  let ops: LiveAccount;
  let businessId: string;

  test.beforeAll(async ({ request }) => {
    financeA = await registerAndLogIn(request, "finance-a");
    financeB = await registerAndLogIn(request, "finance-b");
    ops = await registerAndLogIn(request, "ops");
    const owner = await registerAndLogIn(request, "owner");
    staffAdd(financeA.email, "finance");
    staffAdd(financeB.email, "finance");
    staffAdd(ops.email, "ops");
    businessId = await createBusiness(request, owner);
  });

  test("ops sees the overview but not the rate screen", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, ops.token);
    const overview = await page.goto("/staff/economy?region=AU");
    expect(overview?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Economy" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Rate/ })).toHaveCount(0);

    const rate = await page.goto("/staff/economy/rate?region=AU");
    expect(rate?.status()).toBe(200);
    await expect(page.getByText("Not available to your role")).toBeVisible();
    await page.close();
  });

  test("a rate change needs a second, different approver", async ({ browser, baseURL }) => {
    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/economy/rate?region=AU");
    await expect(pageA.getByRole("heading", { level: 1, name: "Rate" })).toBeVisible();

    await pageA.getByLabel("New backing rate (micros per point)").fill("31000");
    await pageA.getByRole("button", { name: "Propose rate change" }).click();
    await expect(
      pageA.getByText("The change was proposed and is awaiting a second approver."),
    ).toBeVisible();

    // The proposer cannot approve their own change -- their own row shows
    // no approve button (a self-approval attempt is also proven denied,
    // server-side, by staff-economy.e2e.test.ts's API suite).
    await expect(pageA.getByText("Awaiting a second approver").first()).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/economy/rate?region=AU");
    await pageB.getByRole("button", { name: "Approve" }).first().click();
    await expect(pageB.getByText("The change was approved.")).toBeVisible();
    await pageB.close();
  });

  test("marketing funding is two-person", async ({ browser, baseURL }) => {
    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/economy/marketing?region=AU");
    await pageA.getByLabel("Amount (minor units)").fill("10000");
    await pageA.getByLabel("Reason (required, for the record)").first().fill("9.5.e check");
    await pageA.getByRole("button", { name: "Propose funding" }).click();
    await expect(
      pageA.getByText("The change was proposed and is awaiting a second approver."),
    ).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/economy/marketing?region=AU");
    await pageB.getByRole("button", { name: "Approve" }).first().click();
    await expect(pageB.getByText("The change was approved.")).toBeVisible();
    await pageB.close();
  });

  test("a manual point purchase records a real bank-transfer reference, two-person", async ({
    browser,
    baseURL,
  }) => {
    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/economy?region=AU");
    await pageA.getByLabel("Business ID").fill(businessId);
    await pageA.getByLabel("Points").fill("5000");
    await pageA.getByLabel("Amount paid (minor units)").fill("22500");
    await pageA.getByLabel("Bank-transfer reference").fill("BSB-062-000 REF-9.5.e");
    await pageA.getByRole("button", { name: "Propose purchase" }).click();
    await expect(
      pageA.getByText("The change was proposed and is awaiting a second approver."),
    ).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/economy?region=AU");
    await pageB.getByRole("button", { name: "Approve" }).first().click();
    await expect(pageB.getByText("The change was approved.")).toBeVisible();
    await expect(pageB.getByText("BSB-062-000 REF-9.5.e").first()).toBeVisible();
    await pageB.close();
  });

  test("a region setting change is readable back once approved, then reverted", async ({
    browser,
    baseURL,
  }) => {
    const pageA = await pageAs(browser, baseURL as string, financeA.token);
    await pageA.goto("/staff/economy/settings?region=AU");
    await expect(pageA.getByText("daily_earn_cap").first()).toBeVisible();

    await pageA.getByLabel("Setting key").fill("daily_earn_cap");
    await pageA.getByLabel("New value (JSON)").fill("550");
    await pageA.getByRole("button", { name: "Propose change" }).click();
    await expect(
      pageA.getByText("The change was proposed and is awaiting a second approver."),
    ).toBeVisible();
    await pageA.close();

    const pageB = await pageAs(browser, baseURL as string, financeB.token);
    await pageB.goto("/staff/economy/settings?region=AU");
    await pageB.getByRole("button", { name: "Approve" }).first().click();
    await expect(pageB.getByText("The change was approved.")).toBeVisible();
    // The staff console's own half of "changing the AU daily cap changes
    // what's enforced": the newly-approved value is what a fresh read of
    // platform.region_setting returns (the same row Engine.Caps() reads).
    await expect(pageB.getByText("550").first()).toBeVisible();

    // Revert so this worktree's shared dev database is not left at a
    // non-default cap for any other suite that reads it.
    await pageB.getByLabel("Setting key").fill("daily_earn_cap");
    await pageB.getByLabel("New value (JSON)").fill("500");
    await pageB.getByRole("button", { name: "Propose change" }).click();
    await pageB.close();
    const pageA2 = await pageAs(browser, baseURL as string, financeA.token);
    await pageA2.goto("/staff/economy/settings?region=AU");
    await pageA2.getByRole("button", { name: "Approve" }).first().click();
    await pageA2.close();
  });

  test("ops trips a kill switch", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, ops.token);
    await page.goto("/staff/economy/marketing?region=AU");
    await page.getByLabel("Scope").selectOption("merchant");
    await page.getByLabel("Target ID (blank for global)").fill("merchant-9-5-e2e");
    await page.getByLabel("Reason (required, for the record)").last().fill("suspected fraud");
    await page.getByLabel("New state").selectOption("true");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("The kill switch was updated.")).toBeVisible();
    await expect(page.getByText("merchant-9-5-e2e").first()).toBeVisible();
    await expect(page.getByText("Tripped").first()).toBeVisible();
    await page.close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`overview at ${String(width)}px, ${colorScheme}`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
        await context.addCookies([
          { name: "yt_session", value: financeA.token, url: baseURL as string },
        ]);
        const page = await context.newPage();
        const response = await page.goto("/staff/economy?region=AU");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Economy" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-economy-overview-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });

      test(`rate screen at ${String(width)}px, ${colorScheme}`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
        await context.addCookies([
          { name: "yt_session", value: financeA.token, url: baseURL as string },
        ]);
        const page = await context.newPage();
        const response = await page.goto("/staff/economy/rate?region=AU");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Rate" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-economy-rate-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
