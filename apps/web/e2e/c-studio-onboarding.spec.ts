import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * 7.8.d's Check: a new business goes from sign-up through the real Studio
 * UI, against a real `apps/api` + Postgres (`YOURTAL_DATA_SOURCE=live` in
 * this worktree's `.env`; see `playwright.c-studio.config.ts`) — sign-up,
 * onboarding, billing (buying real points), campaign authoring (details,
 * reward within the real F14 ceiling, a compliant question bank), reaching
 * "ready to submit" with the button correctly blocked by the verification
 * banner (a fresh business is never KYB-verified; that's staff-only,
 * 9.3.b, a later phase — this proves the button honours the real, live
 * `business.isVerified` flag, not that submit itself succeeds).
 *
 * Video upload itself is NOT re-proven end to end here — 7.8.b's own
 * earlier pass already proved the real presigned-multipart upload works in
 * isolation (`media-upload-client.ts`), and re-running a real transcode
 * through a headless browser on every CI run of this spec would need a
 * running ffmpeg worker and a real video fixture for no new coverage.
 * `campaign-editor-upload.tsx`'s Video tab is reachable and wired
 * regardless of whether a file has been chosen this run.
 *
 * Still not covered (this feature's own next slice): targeting.districts
 * and budget have no live field in the real DTO at all; chapters have no
 * live PATCH (the real `CampaignChapter` shape genuinely differs — see
 * `campaign-draft-live-mapping.ts`'s doc comment).
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
  let campaignId: string;
  let campaignTitle: string;
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

    campaignTitle = `Cold Brew Launch — E2E ${Date.now()}`;
    await page.getByLabel("Campaign title").fill(campaignTitle);
    await page.getByRole("button", { name: "Back to campaigns" }).click();

    // The title/synopsis PATCH flushes on the way out of the editor, not on
    // every keystroke — a fresh reload (not just this same page's own local
    // state) is what proves it actually reached the server.
    await page.reload();
    await expect(page.getByText(campaignTitle)).toBeVisible();

    // `campaignId` for the next tests' own direct API calls (question
    // add/edit/remove) — the same "confirm via the real GET, not just this
    // page's own local state" reasoning as `businessId` above.
    const campaignsResponse = await context.request.get(
      `${apiBaseUrl()}/api/${businessId}/studio/campaigns`,
      { headers: { cookie: account.cookie } },
    );
    expect(campaignsResponse.ok()).toBeTruthy();
    const campaigns = (await campaignsResponse.json()) as Array<{ id: string; title: string }>;
    const createdCampaign = campaigns.find((entry) => entry.title === campaignTitle);
    expect(
      createdCampaign,
      "the campaign renamed through the editor should exist via GET .../studio/campaigns",
    ).toBeDefined();
    campaignId = createdCampaign?.id as string;

    await context.close();
  });

  test("the campaign is funded (a real allocation), given a compliant question bank, and reaches 'ready to submit' blocked by the verification banner", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, account.cookie);

    // Reuses the Billing test's own real purchase — one business, one
    // funded allocation, the same continuous flow the Check describes
    // ("sign up -> business -> buy points -> ... -> ready to submit").
    const balanceResponse = await context.request.get(
      `${apiBaseUrl()}/api/${businessId}/studio/billing/balance`,
      { headers: { cookie: account.cookie } },
    );
    expect(balanceResponse.ok()).toBeTruthy();
    const balance = (await balanceResponse.json()) as {
      allocations: Array<{ allocationId: string; remainingPoints: number }>;
    };
    expect(
      balance.allocations.length,
      "the Billing test's purchase should have funded an allocation",
    ).toBeGreaterThan(0);

    await page.goto(`/studio/campaigns?business=${businessId}`);
    await page.getByText(campaignTitle).click();

    // --- Reward, discovered against the real F14 ceiling rather than a
    // hardcoded assumption: send an obviously-too-high value first, read
    // the ceiling straight out of the server's own refusal message, then
    // save exactly at it (base only, no bonus, to stay clear of the
    // separate 40%-bonus-ratio rule).
    await page.getByRole("tab", { name: "Reward" }).click();
    await page.getByLabel("Reward (points)").fill("999999");
    const allocationSelect = page.getByLabel("Funded by");
    await allocationSelect.selectOption({
      value: balance.allocations[0]?.allocationId as string,
    });
    await page.getByRole("button", { name: "Save reward" }).click();

    const ceilingError = page.getByText(/exceeds the \d+-point ceiling/);
    await expect(ceilingError).toBeVisible();
    const ceilingText = await ceilingError.textContent();
    const ceilingMatch = /exceeds the (\d+)-point ceiling/.exec(ceilingText ?? "");
    expect(
      ceilingMatch,
      `expected a "N-point ceiling" refusal, got: ${ceilingText}`,
    ).not.toBeNull();
    const ceilingPoints = Number(ceilingMatch?.[1]);

    await page.getByLabel("Reward (points)").fill(String(ceilingPoints));
    await page.getByRole("button", { name: "Save reward" }).click();
    // The server's own priced value replaces "ratio pending" — 7.3.h.
    await expect(page.getByText("Server-priced value (one completion)")).toBeVisible();
    await expect(page.getByText("Ratio pending")).toBeHidden();

    // --- Question bank: 3 true/false questions (this campaign's real,
    // server-known duration is short enough that the server's own
    // questionsAskedFor asks for just 1, so 3 clears the 3x anti-sharing
    // minimum) — each one a real POST, with the server's own id back.
    await page.getByRole("tab", { name: "Questions" }).click();
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole("button", { name: "Add question" }).click();
      await page.getByRole("button", { name: "Add true / false" }).click();
      await page.getByLabel("Question prompt").fill(`Is this fact ${i + 1} true?`);
      await page.getByRole("radio", { name: "True", exact: true }).check();
      await page.getByRole("button", { name: "Save question" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    // Each saved row is server-confirmed live — 7.3.i's real PATCH/DELETE
    // means Edit and Remove are both real now, not locked.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(3);

    // --- Edit the first question through the real PATCH.
    await page
      .locator("li", { hasText: "Is this fact 1 true?" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Question prompt").fill("Is this EDITED fact true?");
    await page.getByRole("button", { name: "Save question" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Is this EDITED fact true?")).toBeVisible();

    // --- Remove a different question through the real DELETE (soft-retire
    // server-side, gone from this bank view — see question-live-actions.ts's
    // own doc comment on why).
    await page
      .locator("li", { hasText: "Is this fact 2 true?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByText("Is this fact 2 true?")).toBeHidden();

    // The real server state: the edited question survives with its new
    // prompt and stays "draft"; the removed one is "retired", not gone
    // outright (docs/06 §4.1 — evidence is never deleted); the untouched
    // third question is unaffected.
    const questionsAfter = (await (
      await context.request.get(
        `${apiBaseUrl()}/api/${businessId}/studio/campaigns/${campaignId}/questions`,
        { headers: { cookie: account.cookie } },
      )
    ).json()) as Array<{ question: { prompt: string }; status: string }>;
    expect(questionsAfter).toHaveLength(3);
    const edited = questionsAfter.find((q) => q.question.prompt === "Is this EDITED fact true?");
    const removed = questionsAfter.find((q) => q.question.prompt === "Is this fact 2 true?");
    const untouched = questionsAfter.find((q) => q.question.prompt === "Is this fact 3 true?");
    expect(edited?.status).toBe("draft");
    expect(removed?.status).toBe("retired");
    expect(untouched?.status).toBe("draft");

    // --- Still blocked by the verification banner, exactly as 7.8.d's
    // Check describes — content-completeness was never the gate here. The
    // status panel (and its Submit button) sits beside the tabs, not
    // inside one, so it's already visible without switching sections.
    const submitButton = page.getByRole("button", { name: "Submit for review" });
    await expect(submitButton).toBeDisabled();
    await expect(
      page.getByText("Verify your business on the overview page before you can submit."),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/c-studio-campaign-ready-to-submit.png",
      fullPage: true,
    });

    await context.close();
  });
});
