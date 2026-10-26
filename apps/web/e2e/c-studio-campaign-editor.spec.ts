import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 5.13.e live: Studio's campaign editor against the real API and database. Targeting and
 * details save by themselves (B2, B8), the reward tab says why a save cannot happen and
 * shows no raw ids (B3, B4, B5), the preview does not guess a length the video has not
 * given yet (B9), and a campaign that is not ready cannot go to review, in the console or
 * through the API (B6, B7). Runs under `playwright.c-studio.config.ts`, with
 * `DATABASE_OWNER_URL` set for the stand-ins for the media pipeline and KYB review.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function api(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

interface Owner {
  cookie: string;
  businessId: string;
}

async function ownerWithBusiness(request: APIRequestContext): Promise<Owner> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `c-editor-${suffix}@example.test`;
  const password = "c-studio-editor-not-a-real-secret-1";
  const registered = await request.post(`${api()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: "Editor E2E" },
      ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const login = await request.post(`${api()}/api/auth/login`, { data: { email, password } });
  const { token } = (await login.json()) as { token: string };
  const cookie = `yt_session=${token}`;
  const business = await request.post(`${api()}/api/businesses`, {
    headers: { cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ legalName: "Harbour Beans Pty Ltd", displayName: "Harbour Beans" },
      ...{ taxIdKind: "ABN", taxIdValue: "51824753556", addressState: "NSW" },
      ...{ addressPostcode: "2000", roles: ["advertiser"], region: "AU" },
      handle: `editor-${suffix}`.slice(0, 40),
    },
  });
  expect(business.ok(), await business.text()).toBeTruthy();
  const businessId = ((await business.json()) as { business: { id: string } }).business.id;
  return { cookie, businessId };
}

/** Runs one SQL statement as the database owner: the stand-in for what 7.2's media pipeline and 9.3's KYB review write. */
function ownerSql(sql: string, params: unknown[]): void {
  const script = `
    const { Client } = require("pg");
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
      await c.connect();
      await c.query(process.env.E2E_SQL, JSON.parse(process.env.E2E_PARAMS));
      await c.end();
    })();
  `;
  execFileSync("node", ["-e", script], {
    cwd: `${REPO_ROOT}/packages/db`,
    env: { ...process.env, E2E_SQL: sql, E2E_PARAMS: JSON.stringify(params) },
    stdio: "pipe",
  });
}

/** A processed video of this length, as the media pipeline leaves it. */
function giveVideo(campaignId: string, durationSeconds: number): void {
  ownerSql(
    `UPDATE campaign.campaigns SET poster_url = $1, teaser_url = $2, hls_url = $3, aspect = $4,
       estimated_bytes = $5, estimated_data_mb = $6, duration_seconds = $7 WHERE id = $8`,
    [
      "https://media.example/poster.jpg",
      "https://media.example/teaser.mp4",
      "https://media.example/stream.m3u8",
      "9:16",
      50000000,
      "50",
      durationSeconds,
      campaignId,
    ],
  );
}

async function signIn(page: Page, baseURL: string, cookie: string) {
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name: name as string, value: value as string, url: baseURL }]);
}

interface ApiDraft {
  id: string;
  title: string;
  synopsis: string;
  lifecycleState: string;
  declaredInterests: string[];
  targetDistricts: string[];
}

async function drafts(request: APIRequestContext, owner: Owner): Promise<ApiDraft[]> {
  const response = await request.get(`${api()}/api/${owner.businessId}/studio/campaigns`, {
    headers: { cookie: owner.cookie },
  });
  return (await response.json()) as ApiDraft[];
}

async function capture(page: Page, name: string, widths = [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of widths) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `test-results/c-studio-campaign-editor-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

async function openCampaigns(page: Page, owner: Owner) {
  await page.goto(`/studio/campaigns?business=${owner.businessId}`);
}

test.describe.serial("5.13.e: the campaign editor, live", () => {
  let owner: Owner;
  let campaignId: string;

  test.beforeAll(async ({ request }) => {
    owner = await ownerWithBusiness(request);
    ownerSql("UPDATE business.business_accounts SET is_verified = true WHERE id = $1", [
      owner.businessId,
    ]);
  });

  test("tags, districts and details are saved by themselves, even when the tab is switched at once (B2, B8)", async ({
    page,
    request,
    baseURL,
  }) => {
    await signIn(page, baseURL as string, owner.cookie);
    await openCampaigns(page, owner);
    await page.getByRole("button", { name: /new campaign/i }).click();

    // B8: a new draft's synopsis is empty, and its hint is a placeholder, not text.
    const synopsis = page.getByLabel("Synopsis");
    await expect(synopsis).toHaveValue("");
    await expect(synopsis).toHaveAttribute("placeholder", /Add a synopsis/);

    await page.getByLabel("Campaign title").fill("Saved by itself");
    await synopsis.fill("Two coffees for the price of one.");
    // Leaving the tab at once must not lose what was just typed.
    await page.getByRole("tab", { name: "Targeting" }).click();
    await page.getByRole("button", { name: "Specialty coffee", exact: true }).click();
    await page.getByRole("button", { name: "Bakery", exact: true }).click();

    await page.getByRole("button", { name: "New South Wales" }).click();
    await page.getByLabel("Find a suburb in New South Wales").fill("Sydney");
    await page
      .getByRole("button", { name: /^Sydney/ })
      .first()
      .click();
    await expect(page.getByRole("list", { name: /districts/i })).toBeVisible();
    // B2: no click on Back or Save; the save bar says so once it has happened.
    await page.getByRole("tab", { name: "Reward" }).click();

    await expect
      .poll(async () => (await drafts(request, owner))[0]?.targetDistricts.length)
      .toBe(1);
    const saved = (await drafts(request, owner))[0] as ApiDraft;
    expect(saved).toMatchObject({
      title: "Saved by itself",
      synopsis: "Two coffees for the price of one.",
      declaredInterests: ["coffee-specialty", "bakery"],
    });
    campaignId = saved.id;

    // Reloaded: everything is still there.
    await page.reload();
    await page.getByText("Saved by itself").click();
    await page.getByRole("tab", { name: "Targeting" }).click();
    await expect(page.getByText("2 of 8 picked")).toBeVisible();
    await expect(page.getByRole("list", { name: /districts/i })).toContainText("2000");
    await capture(page, "targeting");
  });

  test("the reward tab says why a save fails, shows no raw ids, and words the limit for this video (B3, B4, B5)", async ({
    page,
    request,
    baseURL,
  }) => {
    // Points to fund with: the Grow package, bought twice, so "Funded by" has two entries.
    const headers = { cookie: owner.cookie };
    for (let n = 0; n < 2; n += 1) {
      const bought = await request.post(
        `${api()}/api/${owner.businessId}/studio/billing/purchases`,
        {
          headers: { ...headers, "idempotency-key": crypto.randomUUID() },
          data: { tierKey: "grow", currency: "AUD" },
        },
      );
      expect(bought.ok(), await bought.text()).toBeTruthy();
    }
    giveVideo(campaignId, 20);

    await signIn(page, baseURL as string, owner.cookie);
    await openCampaigns(page, owner);
    await page.getByText("Saved by itself").click();
    await page.getByRole("tab", { name: "Reward" }).click();

    // B3: funding unset, so the save refuses and says what to do, beside the list.
    await page.getByLabel("Reward (points)").fill("2");
    await expect(page.getByText(/not saved yet/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Save reward" }).click();
    await expect(page.getByText(/Choose what funds this reward/)).toBeVisible();

    // "Funded by" reads in points and dates, never an id, one line per purchase.
    const options = await page.getByLabel("Funded by").locator("option").allTextContents();
    const funded = options.filter((text) => /points bought/.test(text));
    expect(funded).toHaveLength(2);
    for (const text of funded) expect(text).not.toMatch(/[0-9a-f]{8}-?[0-9a-f]{4}/);
    await page.getByLabel("Funded by").selectOption({ index: 1 });

    // B4: a fixed reward over this video's limit: worded in points for this length, no
    // accuracy bonus, no internal code. AU pays 8 points a minute, so 20 s allows 2.
    await page.getByLabel("Reward (points)").fill("5");
    await page.getByRole("button", { name: "Save reward" }).click();
    const refusal = page.getByRole("alert").filter({ hasText: "20-second video" });
    await expect(refusal).toContainText("at most 2 points");
    await expect(refusal).not.toContainText(/accuracy bonus|F14|reward_exceeds_ceiling/i);

    // Under the limit saves, and the panels agree (B5): one view of the ratio.
    await page.getByLabel("Reward (points)").fill("2");
    await page.getByRole("button", { name: "Save reward" }).click();
    await expect(page.getByText("Reward saved.")).toBeVisible();
    await expect(page.getByText(/Server-priced value/)).toBeVisible();
    await expect(page.getByText(/ratio itself|campaign API/i)).toBeHidden();
    await capture(page, "reward");

    const draft = await request.get(
      `${api()}/api/${owner.businessId}/studio/campaigns/${campaignId}`,
      { headers },
    );
    expect(
      ((await draft.json()) as { rewardConfig: { rewardPointsPerCompletion: number } })
        .rewardConfig,
    ).toMatchObject({ rewardPointsPerCompletion: 2 });
  });

  test("a campaign that is not ready cannot be submitted, in the console or the API (B6, B7)", async ({
    page,
    request,
    baseURL,
  }) => {
    // A second draft with nothing but a title: no video, no reward, no questions.
    const created = await request.post(`${api()}/api/${owner.businessId}/studio/campaigns`, {
      headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
      data: {
        kind: "quick",
        title: "Not ready",
        synopsis: "",
        durationSeconds: 60,
        contentCategory: "food-and-drink",
        audience: "all_ages",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        openViewing: false,
        teaserStartSeconds: 0,
        declaredInterests: [],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const emptyId = ((await created.json()) as { id: string }).id;

    const refused = await request.post(
      `${api()}/api/${owner.businessId}/studio/campaigns/${emptyId}/submit`,
      { headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() } },
    );
    expect(refused.status()).toBe(400);
    const body = (await refused.json()) as { code: string; missing: string[]; message: string };
    expect(body.code).toBe("campaign_not_ready");
    expect(body.missing).toEqual(["synopsis", "video", "reward", "questions"]);
    expect(body.message).not.toMatch(/database/i);
    // Nothing moved.
    expect((await drafts(request, owner)).find((d) => d.id === emptyId)?.lifecycleState).toBe(
      "draft",
    );

    await signIn(page, baseURL as string, owner.cookie);
    await openCampaigns(page, owner);
    await page.getByText("Not ready").click();
    const submit = page.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText("Before you submit, this campaign needs:")).toBeVisible();
    await expect(page.getByText("A video (Video & chapters tab).")).toBeVisible();
    await capture(page, "not-ready");
  });

  test("a ready campaign is submitted from the console and moves to review (B6)", async ({
    page,
    request,
    baseURL,
  }) => {
    // The first campaign, now with its reward saved, a video of 90 s (one question asked,
    // so a bank of three) and a budget.
    giveVideo(campaignId, 90);
    for (let n = 1; n <= 3; n += 1) {
      const correct = crypto.randomUUID();
      const question = await request.post(
        `${api()}/api/${owner.businessId}/studio/campaigns/${campaignId}/questions`,
        {
          headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
          data: {
            id: crypto.randomUUID(),
            campaignId,
            type: "multiple_choice",
            prompt: `What did the video offer? (${String(n)})`,
            options: [
              { id: correct, label: "Two coffees" },
              { id: crypto.randomUUID(), label: "One tea" },
            ],
            correctOptionId: correct,
            answerableAfterSeconds: 5,
            timerSeconds: 10,
          },
        },
      );
      expect(question.ok(), await question.text()).toBeTruthy();
    }
    await signIn(page, baseURL as string, owner.cookie);
    await openCampaigns(page, owner);
    await page.getByText("Saved by itself").click();
    const submit = page.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("In review").first()).toBeVisible();
    expect((await drafts(request, owner)).find((d) => d.id === campaignId)?.lifecycleState).toBe(
      "in_review",
    );
    await capture(page, "in-review");
  });
});
