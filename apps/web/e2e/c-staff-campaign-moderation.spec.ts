import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * TASKS.md 9.2.b's Check: a submitted campaign goes live only after
 * approval and then appears in `GET /api/feed`; a rejection shows its
 * reason in Studio. Campaign creation, question bank and reward are done
 * through the real API (9.3.b's own spec, `c-staff-kyb-submit.spec.ts`,
 * already proves that whole flow through the Studio UI end to end -- this
 * spec's own job is the part 9.3.b did not build: the moderation queue and
 * what happens after it decides), submitted through the real API (same
 * endpoint the Submit button calls), then driven through the real
 * `/staff/moderation` UI for the decision itself.
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
  userId?: string;
}

async function registerAndLogIn(request: APIRequestContext, tag: string): Promise<LiveAccount> {
  const email = `c-staff-campaign-mod-${tag}-${uniqueSuffix()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Campaign Moderation E2E",
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

/** Same stand-in `c-staff-kyb-submit.spec.ts` uses for 7.2's real media pipeline. */
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
      // The viewer-facing repository's own campaignSchema requires a
      // videoSource row (packages/contracts/src/campaign/campaign.ts) --
      // 7.2's real media pipeline writes this; this stands in the same way
      // the columns above stand in for the rest of that pipeline.
      await c.query(
        \`INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
          VALUES ($1, 'hls', 'https://media.example/stream.m3u8')
          ON CONFLICT DO NOTHING\`,
        ["${campaignId}"],
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

/** KYB approval itself is 9.3.a's own proof -- flipped directly, the same "not this ticket's scope" reasoning `fillCampaignMedia` uses for 7.2. */
function markKybVerified(businessId: string): void {
  const script = `
    const { Client } = require("pg");
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
      await c.connect();
      await c.query("UPDATE business.business_accounts SET is_verified = true WHERE id = $1", ["${businessId}"]);
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

async function createBusiness(request: APIRequestContext, owner: LiveAccount): Promise<string> {
  const handle = `c-cm-${uniqueSuffix()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      legalName: `Staff Campaign Moderation E2E Pty Ltd ${handle}`,
      displayName: "Staff Campaign Moderation E2E",
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser", "supplier"],
      region: "AU",
      handle,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { business: { id: string } };
  return body.business.id;
}

/** A funded, submitted-for-review campaign -- everything up to `in_review`, through the real API. */
async function createSubmittedCampaign(
  request: APIRequestContext,
  owner: LiveAccount,
  businessId: string,
  title: string,
): Promise<string> {
  const now = Date.now();
  const created = await request.post(`${apiBaseUrl()}/api/${businessId}/studio/campaigns`, {
    headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      kind: "quick",
      title,
      synopsis: "Exercises the staff campaign moderation UI end to end.",
      durationSeconds: 60,
      contentCategory: "food-and-drink",
      audience: "all_ages",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      openViewing: false,
      teaserStartSeconds: 0,
      declaredInterests: [],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const campaignId = ((await created.json()) as { id: string }).id;
  fillCampaignMedia(campaignId);

  const correctOptionId = crypto.randomUUID();
  const question = await request.post(
    `${apiBaseUrl()}/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    {
      headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
      data: {
        id: crypto.randomUUID(),
        campaignId,
        type: "multiple_choice",
        prompt: "Which discount did the video mention?",
        options: [
          { id: correctOptionId, label: "10% off" },
          { id: crypto.randomUUID(), label: "20% off" },
        ],
        correctOptionId,
        answerableAfterSeconds: 5,
        timerSeconds: 10,
      },
    },
  );
  expect(question.ok(), await question.text()).toBeTruthy();

  const purchase = await request.post(
    `${apiBaseUrl()}/api/${businessId}/studio/billing/purchases`,
    {
      headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
      data: { points: 10_000, currency: "AUD" },
    },
  );
  expect(purchase.ok(), await purchase.text()).toBeTruthy();
  const allocationId = ((await purchase.json()) as { allocation: { allocationId: string } })
    .allocation.allocationId;

  // AU's F14 ceiling for a 60s "quick" campaign is small -- 5+0 stays safely under it.
  const reward = await request.put(
    `${apiBaseUrl()}/api/${businessId}/studio/campaigns/${campaignId}/reward`,
    {
      headers: { cookie: owner.cookie },
      data: {
        allocationId,
        rewardPointsPerCompletion: 5,
        accuracyBonusPoints: 0,
        maxPointsForCampaign: 5,
      },
    },
  );
  expect(reward.ok(), await reward.text()).toBeTruthy();

  const submitted = await request.post(
    `${apiBaseUrl()}/api/${businessId}/studio/campaigns/${campaignId}/submit`,
    { headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() } },
  );
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  expect((await submitted.json()) as { lifecycleState: string }).toMatchObject({
    lifecycleState: "in_review",
  });
  return campaignId;
}

test.describe.serial("9.2.a/9.2.b: staff campaign moderation, through the real UI", () => {
  let owner: LiveAccount;
  let staff: LiveAccount;
  let viewer: LiveAccount;
  let businessId: string;
  let approvedCampaignId: string;
  let rejectedCampaignId: string;
  const approvedTitle = `Approve Me ${uniqueSuffix()}`;
  const rejectedTitle = `Reject Me ${uniqueSuffix()}`;
  const rejectionReason = `Creative does not meet disclosure requirements (${uniqueSuffix()}).`;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "owner");
    staff = await registerAndLogIn(request, "moderator");
    viewer = await registerAndLogIn(request, "viewer");
    staffAdd(staff.email, "moderator");
    businessId = await createBusiness(request, owner);
    markKybVerified(businessId);
    approvedCampaignId = await createSubmittedCampaign(request, owner, businessId, approvedTitle);
    rejectedCampaignId = await createSubmittedCampaign(request, owner, businessId, rejectedTitle);
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`the campaign moderation queue renders at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([
          { name: "yt_session", value: staff.token, url: baseURL as string },
        ]);
        const page = await context.newPage();
        const response = await page.goto("/staff/moderation");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Moderation" })).toBeVisible();
        await expect(page.locator(":visible", { hasText: approvedTitle }).first()).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-campaign-moderation-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }

  test("a moderator approves a campaign: it goes live and appears in the feed", async ({
    browser,
    baseURL,
    request,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, staff.cookie);
    await page.goto("/staff/moderation");
    await expect(page.locator(":visible", { hasText: approvedTitle }).first()).toBeVisible();

    const row = page.locator("tr, li").filter({ hasText: approvedTitle }).first();
    await row.getByRole("button", { name: "Approve" }).click();
    await page
      .getByLabel("Reason (required, for the record)")
      .fill("Creative and question bank both look clean.");
    await page.getByRole("button", { name: "Approve campaign" }).click();
    await expect(page.getByText(approvedTitle)).toHaveCount(0);
    await context.close();

    const feedResponse = await request.get(`${apiBaseUrl()}/api/feed`, {
      headers: { cookie: viewer.cookie },
    });
    expect(feedResponse.ok(), await feedResponse.text()).toBeTruthy();
    const feed = (await feedResponse.json()) as { items: Array<{ campaignId: string }> };
    expect(feed.items.map((item) => item.campaignId)).toContain(approvedCampaignId);
  });

  test("a moderator rejects a campaign: Studio shows the reason", async ({
    browser,
    baseURL,
    request,
  }) => {
    const { context, page } = await newSessionContext(browser, baseURL as string, staff.cookie);
    await page.goto("/staff/moderation");
    await expect(page.locator(":visible", { hasText: rejectedTitle }).first()).toBeVisible();

    const row = page.locator("tr, li").filter({ hasText: rejectedTitle }).first();
    await row.getByRole("button", { name: "Reject" }).click();
    await page.getByLabel("Reason (required, for the record)").fill(rejectionReason);
    await page.getByRole("button", { name: "Reject campaign" }).click();
    await expect(page.getByText(rejectedTitle)).toHaveCount(0);
    await context.close();

    const { context: ownerContext, page: ownerPage } = await newSessionContext(
      browser,
      baseURL as string,
      owner.cookie,
    );
    await ownerPage.goto(`/studio/campaigns?business=${businessId}`);
    await ownerPage.getByText(rejectedTitle).click();
    // Two badges legitimately say "Rejected" once the editor opens (the
    // list row behind it, still in the DOM, and the editor's own status
    // panel) -- `.last()` is the editor's, rendered after the list.
    await expect(ownerPage.getByText("Rejected", { exact: true }).last()).toBeVisible();
    await expect(ownerPage.getByText(rejectionReason)).toBeVisible();
    await ownerPage.screenshot({
      path: "test-results/c-staff-campaign-moderation-rejection-reason.png",
      fullPage: true,
    });
    await ownerContext.close();

    const feedResponse = await request.get(`${apiBaseUrl()}/api/feed`, {
      headers: { cookie: viewer.cookie },
    });
    expect(feedResponse.ok(), await feedResponse.text()).toBeTruthy();
    const feed = (await feedResponse.json()) as { items: Array<{ campaignId: string }> };
    expect(feed.items.map((item) => item.campaignId)).not.toContain(rejectedCampaignId);
  });
});
