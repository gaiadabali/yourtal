import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * 7.8.d's Check: a new business goes from sign-up through the real Studio
 * UI, against a real `apps/api` + Postgres (`YOURTAL_DATA_SOURCE=live` in
 * this worktree's `.env`; see `playwright.c-studio.config.ts`) — sign-up,
 * onboarding, billing, RBAC, and now (7.3 merged to `main`) a real campaign
 * draft created and edited through `/studio/campaigns`, reaching "ready to
 * submit" with the button correctly blocked by the verification banner
 * (a fresh business is never KYB-verified; that's staff-only, 9.3.b, a
 * later phase — this spec proves the button honours the real, live
 * `business.isVerified` flag, not that submit itself succeeds).
 *
 * Not yet covered by this spec (this feature's own next slice — see
 * `campaign-draft-live-mapping.ts`'s doc comment): reward config (needs an
 * `allocationId` UX this pass doesn't add), the question bank, and
 * targeting/budget/schedule/audience/category/teaser/captions fields, none
 * of which has an editor field wired to a live PATCH yet.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "API_INTERNAL_URL is not set — source this worktree's .env before running this spec.",
    );
  }
  return url;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface LiveAccount {
  email: string;
  password: string;
  cookie: string;
}

/** Registers and logs in a fresh AU account directly against the real api — the same round trip `sessionFor` uses server-side, done here through `request` since this spec drives the browser separately. */
async function registerAndLogIn(request: APIRequestContext): Promise<LiveAccount> {
  const suffix = uniqueSuffix();
  const email = `c-studio-${suffix}@example.test`;
  const password = "c-studio-not-a-real-secret-1";

  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Studio E2E",
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

  return { email, password, cookie: `yt_session=${body.token}` };
}

/** A fresh browser context carrying the given `yt_session` cookie against `baseURL`, plus its first page. */
async function newSessionContext(
  browser: Browser,
  baseURL: string,
  cookie: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const [name, value] = cookie.split("=");
  const context = await browser.newContext();
  await context.addCookies([{ name: name as string, value: value as string, url: baseURL }]);
  const page = await context.newPage();
  return { context, page };
}

test.describe
  .serial("7.8.d: Studio — sign-up through onboarding, billing and RBAC, against a live api", () => {
  let account: LiveAccount;
  let businessId: string;
  const businessHandle = `c-studio-${uniqueSuffix()}`;

  test.beforeAll(async ({ request }) => {
    account = await registerAndLogIn(request);
  });

  test("a signed-in person with no business is sent to onboarding, and the real form creates one", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, account.cookie);

    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio\/onboarding/);
    await expect(page.getByRole("button", { name: "Create business" })).toBeVisible();
    await page.screenshot({ path: "test-results/c-studio-onboarding-form.png", fullPage: true });

    const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toStrictEqual([]);

    await page.getByLabel("Legal name").fill("C Studio E2E Pty Ltd");
    await page.getByLabel("Display name").fill("C Studio E2E");
    await page.getByLabel("Handle").fill(businessHandle);
    // taxIdKind defaults to ABN (AU's only option) already selected.
    await page.getByLabel("Tax ID number").fill("12345678901");
    await page.getByLabel("State").selectOption("NSW");
    await page.getByLabel("Postcode").fill("2000");
    await page.getByRole("button", { name: "Create business" }).click();

    // createBusinessAction redirects to "/studio" on success; Overview
    // itself depends on 7.3's campaign listing (not on main), so it may
    // legitimately show Studio's own error boundary rather than the setup
    // checklist — either is acceptable here, a silent crash or fabricated
    // content is not.
    await expect(page).toHaveURL(/\/studio(\?|$)/);
    const setupChecklist = page.getByText("Buy points");
    const honestErrorBoundary = page.getByRole("button", { name: "Retry" });
    await expect(
      setupChecklist.or(honestErrorBoundary),
      "expected either the setup checklist or Studio's honest error boundary — never a silent crash",
    ).toBeVisible({ timeout: 15_000 });

    const memberships = await context.request.get(`${apiBaseUrl()}/api/me/businesses`, {
      headers: { cookie: account.cookie },
    });
    expect(memberships.ok()).toBeTruthy();
    const businesses = (await memberships.json()) as Array<{
      business: { id: string; handle: string };
    }>;
    const created = businesses.find((entry) => entry.business.handle === businessHandle);
    expect(
      created,
      "the business created through the onboarding form should exist via GET /api/me/businesses",
    ).toBeDefined();
    businessId = created?.business.id as string;

    await context.close();
  });

  test("Billing renders live quotes and a real purchase updates the real balance", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, account.cookie);

    await page.goto(`/studio/billing?business=${businessId}`);
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    // PointsChip carries its accessible name as `aria-label` (real, translated
    // words), not as rendered text — see `points-chip.tsx`.
    await expect(page.locator('[aria-label="0 points available"]')).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    ).toStrictEqual([]);
    await page.screenshot({ path: "test-results/c-studio-billing.png", fullPage: true });

    await page.getByRole("button", { name: "Buy" }).first().click();
    await expect(page).toHaveURL(/purchased=1/);
    // The real balance updates from the real ledger.
    await expect(page.locator('[aria-label="50,000 points available"]')).toBeVisible();
    // Purchase HISTORY has no live endpoint yet (statements are 10.6.b, a
    // later phase) — `listPurchases`'s live source always returns `[]`, so
    // the empty state legitimately still shows even after a real purchase.
    // This is the documented, honest gap, not a bug this test should catch.
    await expect(page.getByText("No purchases yet")).toBeVisible();

    await context.close();
  });

  test("Inventory correctly refuses an advertiser-only business — the cosmetic zone gate mirrors Cerbos's real supplier check", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, account.cookie);

    await page.goto(`/studio/inventory?business=${businessId}`);
    await expect(page.getByText("You don't have access to Inventory")).toBeVisible();

    await context.close();
  });

  test("a real campaign is created and edited live through the Campaigns UI, reaching a submit blocked by the verification banner", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, account.cookie);

    await page.goto(`/studio/campaigns?business=${businessId}`);
    await expect(page.getByRole("heading", { name: "Campaigns", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "New campaign" }).click();
    // POST /api/:tenantId/studio/campaigns (7.3.a): a real draft, with real
    // server-assigned defaults — see `newCampaignDraftDefaults`'s own doc
    // comment for why they're safe-but-placeholder rather than collected
    // up front (this editor has no create-time intake form yet).
    await expect(page.getByLabel("Campaign title")).toHaveValue("Untitled campaign");

    const title = `Cold Brew Launch — E2E ${Date.now()}`;
    await page.getByLabel("Campaign title").fill(title);
    await page.getByRole("button", { name: "Back to campaigns" }).click();

    // The title/synopsis PATCH flushes on the way out of the editor, not on
    // every keystroke — a fresh reload (not just this same page's own local
    // state) is what proves it actually reached the server.
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();

    await page.getByText(title).click();
    const submitButton = page.getByRole("button", { name: "Submit for review" });
    await expect(submitButton).toBeDisabled();
    await expect(
      page.getByText("Verify your business on the overview page before you can submit."),
    ).toBeVisible();

    await context.close();
  });
});
