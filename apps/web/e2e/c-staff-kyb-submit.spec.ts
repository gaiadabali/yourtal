import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * TASKS.md 9.3.b's Check, the submit half (moved from 7.8.d, unblocked now
 * that 7.3 is merged): a business made through the real Studio UI builds a
 * funded campaign with a question bank and reaches "ready to submit",
 * blocked by the verification banner (7.8.d's own proof, reused here
 * rather than duplicated); an `ops` staffer approves its KYB through the
 * real `/staff/businesses` UI; the SAME business, reloaded, submits for
 * real and the campaign moves to `in_review`.
 *
 * Runs against a live api + web on this slot
 * (`YOURTAL_DATA_SOURCE=live`, `playwright.c-staff.config.ts`).
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function apiBaseUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface LiveAccount {
  email: string;
  cookie: string;
  token: string;
}

async function registerAndLogIn(request: APIRequestContext, tag: string): Promise<LiveAccount> {
  const email = `c-staff-kyb-${tag}-${uniqueSuffix()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff KYB Submit E2E",
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
  return { email, token: body.token, cookie: `yt_session=${body.token}` };
}

function staffAdd(email: string, role: string): void {
  execFileSync("pnpm", ["staff:add", email, role], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

/**
 * Stands in for 7.2's real video-upload/transcode pipeline, the same way
 * `studio-campaign-authoring.e2e.test.ts` (7.3.e's own Check) already does
 * for the identical reason: `campaigns_media_required_past_draft` is a real
 * DB CHECK a submit cannot pass without these six columns, and driving a
 * real multipart upload + ffmpeg transcode through a headless browser here
 * would prove 7.2 a second time, not 9.3.b. Shells out to a one-off `node`
 * script (this repo's own `pg`, from `packages/db`) rather than adding a
 * `pg` dependency to `apps/web` for one spec.
 */
function fillCampaignMedia(campaignId: string): void {
  const script = `
    const { Client } = require("pg");
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
      await c.connect();
      await c.query(
        \`UPDATE campaign.campaigns SET poster_url = $1, teaser_url = $2, hls_url = $3,
           aspect = $4, estimated_bytes = $5, estimated_data_mb = $6 WHERE id = $7\`,
        ["https://media.example/poster.jpg", "https://media.example/teaser.mp4",
         "https://media.example/stream.m3u8", "9:16", 50000000, "50", "${campaignId}"],
      );
      await c.end();
    })();
  `;
  execFileSync("node", ["-e", script], {
    cwd: `${REPO_ROOT}/packages/db`,
    env: process.env,
    stdio: "pipe",
  });
}

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

async function expectAxeClean(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual(
    [],
  );
}

test.describe.serial("9.3.b: approving KYB unblocks submit, through the real Studio UI", () => {
  let owner: LiveAccount;
  let staff: LiveAccount;
  let businessId: string;
  let campaignId: string;
  let campaignTitle: string;
  const businessHandle = `c-staff-kyb-${uniqueSuffix()}`;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "owner");
    staff = await registerAndLogIn(request, "ops");
    staffAdd(staff.email, "ops");
  });

  test("a funded campaign with a question bank reaches ready-to-submit, blocked by the verification banner", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, owner.cookie);

    // --- Onboarding: a real business through the real form.
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio\/onboarding/);
    await page.getByLabel("Legal name").fill("Staff KYB Submit E2E Pty Ltd");
    await page.getByLabel("Display name").fill("Staff KYB Submit E2E");
    await page.getByLabel("Handle").fill(businessHandle);
    await page.getByLabel("Tax ID number").fill("12345678901");
    await page.getByLabel("State").selectOption("NSW");
    await page.getByLabel("Postcode").fill("2000");
    await page.getByRole("button", { name: "Create business" }).click();
    await expect(page).toHaveURL(/\/studio(\?|$)/);

    const memberships = await context.request.get(`${apiBaseUrl()}/api/me/businesses`, {
      headers: { cookie: owner.cookie },
    });
    expect(memberships.ok()).toBeTruthy();
    const businesses = (await memberships.json()) as Array<{
      business: { id: string; handle: string };
    }>;
    const created = businesses.find((entry) => entry.business.handle === businessHandle);
    expect(created).toBeDefined();
    businessId = created?.business.id as string;

    // --- Billing: a real purchase, funding a real allocation.
    await page.goto(`/studio/billing?business=${businessId}`);
    await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Buy" }).first().click();
    await expect(page).toHaveURL(/purchased=1/);

    // --- Campaign: a real draft, renamed, then funded and given a
    // one-question bank.
    await page.goto(`/studio/campaigns?business=${businessId}`);
    await page.getByRole("button", { name: "New campaign" }).click();
    campaignTitle = `Staff KYB Submit E2E ${uniqueSuffix()}`;
    await page.getByLabel("Campaign title").fill(campaignTitle);
    await page.getByRole("button", { name: "Back to campaigns" }).click();
    await page.reload();
    await expect(page.getByText(campaignTitle)).toBeVisible();

    const campaignsResponse = await context.request.get(
      `${apiBaseUrl()}/api/${businessId}/studio/campaigns`,
      { headers: { cookie: owner.cookie } },
    );
    const campaigns = (await campaignsResponse.json()) as Array<{ id: string; title: string }>;
    campaignId = campaigns.find((entry) => entry.title === campaignTitle)?.id as string;
    expect(campaignId).toBeDefined();
    fillCampaignMedia(campaignId);

    const balanceResponse = await context.request.get(
      `${apiBaseUrl()}/api/${businessId}/studio/billing/balance`,
      { headers: { cookie: owner.cookie } },
    );
    const balance = (await balanceResponse.json()) as {
      allocations: Array<{ allocationId: string; remainingPoints: number }>;
    };
    expect(balance.allocations.length).toBeGreaterThan(0);

    await page.goto(`/studio/campaigns?business=${businessId}`);
    await page.getByText(campaignTitle).click();

    // Reward, discovered against the real F14 ceiling (same technique
    // 7.8.d's own spec uses): send an obviously-too-high value first, read
    // the ceiling from the server's own refusal, save exactly at it.
    await page.getByRole("tab", { name: "Reward" }).click();
    await page.getByLabel("Reward (points)").fill("999999");
    await page
      .getByLabel("Funded by")
      .selectOption({ value: balance.allocations[0]?.allocationId as string });
    await page.getByRole("button", { name: "Save reward" }).click();
    const ceilingText = await page.getByText(/exceeds the \d+-point ceiling/).textContent();
    const ceilingPoints = Number(/exceeds the (\d+)-point ceiling/.exec(ceilingText ?? "")?.[1]);
    expect(ceilingPoints).toBeGreaterThan(0);
    await page.getByLabel("Reward (points)").fill(String(ceilingPoints));
    await page.getByRole("button", { name: "Save reward" }).click();
    await expect(page.getByText("Server-priced value (one completion)")).toBeVisible();

    // A one-question bank -- enough to be a real question bank; 7.3's own
    // legality check for draft -> in_review is the lifecycle state machine
    // only (transition-campaign-lifecycle.use-case.ts), not question-bank
    // content, so this is about a faithful advertiser flow, not a submit
    // precondition.
    await page.getByRole("tab", { name: "Questions" }).click();
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByRole("button", { name: "Add true / false" }).click();
    await page.getByLabel("Question prompt").fill("Is this fact true?");
    await page.getByRole("radio", { name: "True", exact: true }).check();
    await page.getByRole("button", { name: "Save question" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Still blocked -- the verification banner, not content completeness.
    const submitButton = page.getByRole("button", { name: "Submit for review" });
    await expect(submitButton).toBeDisabled();
    await expect(
      page.getByText("Verify your business on the overview page before you can submit."),
    ).toBeVisible();

    await context.close();
  });

  test("an ops staffer approves the business's KYB through /staff/businesses", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, staff.cookie);

    await page.goto(`/staff/businesses/${businessId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Staff KYB Submit E2E" }),
    ).toBeVisible();
    await expect(page.getByText("Unverified")).toBeVisible();
    await expectAxeClean(page);

    await page.getByRole("button", { name: "Approve KYB" }).click();
    await page.getByLabel("Reason (required, for the record)").fill("Documents check out.");
    await page.getByRole("button", { name: "Approve KYB", exact: true }).last().click();
    await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();

    await context.close();
  });

  test("the owner reloads the campaign and submits it for real; it moves to in_review", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, owner.cookie);

    await page.goto(`/studio/campaigns?business=${businessId}`);
    await page.getByText(campaignTitle).click();

    const submitButton = page.getByRole("button", { name: "Submit for review" });
    await expect(submitButton).toBeEnabled();
    await expect(
      page.getByText("Verify your business on the overview page before you can submit."),
    ).toBeHidden();

    await submitButton.click();
    await expect(page.getByText("In review")).toBeVisible();
    await page.screenshot({
      path: "test-results/c-staff-kyb-submit-in-review.png",
      fullPage: true,
    });

    const campaignsResponse = await context.request.get(
      `${apiBaseUrl()}/api/${businessId}/studio/campaigns`,
      { headers: { cookie: owner.cookie } },
    );
    const campaigns = (await campaignsResponse.json()) as Array<{
      id: string;
      lifecycleState: string;
    }>;
    const submitted = campaigns.find((entry) => entry.id === campaignId);
    expect(
      submitted?.lifecycleState,
      "GET .../studio/campaigns should show the real, persisted lifecycleState",
    ).toBe("in_review");

    await context.close();
  });
});
