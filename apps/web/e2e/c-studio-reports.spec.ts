import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 5.13.h live: Studio's Reports lists each campaign's own views, completions and spend from
 * the watch sessions and the ledger, withholds them below the cohort floor, and tells a
 * finance member whose campaigns they are instead of "no campaigns yet". Runs under
 * `playwright.c-studio.config.ts` with `DATABASE_OWNER_URL` set (the campaigns and watch
 * sessions are written directly: going live and being watched are other zones' proofs).
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function api(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

interface Account {
  cookie: string;
  userId: string;
}

async function account(request: APIRequestContext, tag: string): Promise<Account> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `c-reports-${tag}-${suffix}@example.test`;
  const password = "c-studio-reports-not-a-real-secret-1";
  const registered = await request.post(`${api()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: `Reports ${tag}` },
      ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const login = await request.post(`${api()}/api/auth/login`, { data: { email, password } });
  const { token } = (await login.json()) as { token: string };
  const cookie = `yt_session=${token}`;
  const me = await request.get(`${api()}/api/me`, { headers: { cookie } });
  return { cookie, userId: ((await me.json()) as { profile: { userId: string } }).profile.userId };
}

/** Runs a script as the database owner (the stand-in for what other zones write). */
function ownerScript(body: string, env: Record<string, string>): void {
  const script = `
    const { Client } = require("pg");
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
      await c.connect();
      ${body}
      await c.end();
    })();
  `;
  execFileSync("node", ["-e", script], {
    cwd: `${REPO_ROOT}/packages/db`,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
}

/** A live campaign with this many viewers, `done` of whom finished. */
function liveCampaignWithViews(businessId: string, title: string, views: number, done: number) {
  ownerScript(
    `
    const id = crypto.randomUUID();
    await c.query(\`INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds)
      VALUES ($1, 'long_form', $2, $3, 'Harbour Beans', 'A live campaign for the Reports spec.', 30, 10,
       5, 0, 'base_only', 'live', now(), $3, 'AU', 'all_ages', 'food-and-drink',
       'https://cdn.example.com/p.jpg', 'https://cdn.example.com/t.mp4',
       'https://cdn.example.com/m.m3u8', '9:16', 1000000, now(), now() + interval '30 days', false, 0)\`,
      [id, process.env.E2E_TITLE, process.env.E2E_BUSINESS]);
    await c.query(\`INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds,
       accuracy_bonus_points, effective_from)
      VALUES ($1, 1, 5, 0, 'base_only', 30, 0, now())\`, [id]);
    for (let n = 0; n < Number(process.env.E2E_VIEWS); n += 1) {
      const done = n < Number(process.env.E2E_DONE);
      await c.query(\`INSERT INTO watch.session
        (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at,
         completed_at, non_earning, non_earning_reason, hold_id, questions_asked,
         questions_correct, granted)
        VALUES (gen_random_uuid(), gen_random_uuid(), $1, 1, $2, now() - interval '30 seconds', now(),
          $3, false, null, null, 0, 0, $4)\`,
        [id, done ? "completed" : "active", done ? new Date().toISOString() : null, done]);
    }
  `,
    {
      E2E_TITLE: title,
      E2E_BUSINESS: businessId,
      E2E_VIEWS: String(views),
      E2E_DONE: String(done),
    },
  );
}

async function signIn(page: Page, baseURL: string, cookie: string) {
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name: name as string, value: value as string, url: baseURL }]);
}

async function capture(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `test-results/c-studio-reports-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

test("Reports shows each campaign's real views, and tells finance whose campaigns they are", async ({
  page,
  request,
  baseURL,
}) => {
  const owner = await account(request, "owner");
  const business = await request.post(`${api()}/api/businesses`, {
    headers: { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ legalName: "Harbour Beans Pty Ltd", displayName: "Harbour Beans" },
      ...{ taxIdKind: "ABN", taxIdValue: "51824753556", addressState: "NSW" },
      ...{ addressPostcode: "2000", roles: ["advertiser"], region: "AU" },
      handle: `reports-${Date.now()}`,
    },
  });
  expect(business.ok(), await business.text()).toBeTruthy();
  const businessId = ((await business.json()) as { business: { id: string } }).business.id;

  liveCampaignWithViews(businessId, "Well watched", 14, 9);
  liveCampaignWithViews(businessId, "Barely watched", 3, 1);

  await signIn(page, baseURL as string, owner.cookie);
  await page.goto(`/studio/reports?business=${businessId}`);
  const busy = page.getByRole("row", { name: /Well watched/ }).first();
  // Rewarded views and completions straight from the sessions written above.
  await expect(busy).toContainText("14");
  await expect(busy).toContainText("9");
  // Three viewers is under the cohort floor, so nothing is shown for it, and it says why.
  const quiet = page.getByRole("row", { name: /Barely watched/ }).first();
  await expect(quiet).toContainText("Under 10 viewers so far");
  await expect(quiet).not.toContainText(/\b3\b/);
  await capture(page, "owner");

  // A finance member can open Reports but may not see campaigns: the page says so.
  const finance = await account(request, "finance");
  ownerScript(
    `await c.query(
       "INSERT INTO business.business_members (business_id, user_id, role, invited_by_user_id, joined_at) VALUES ($1, $2, 'finance', $2, now())",
       [process.env.E2E_BUSINESS, process.env.E2E_USER]);`,
    { E2E_BUSINESS: businessId, E2E_USER: finance.userId },
  );
  await page.context().clearCookies();
  await signIn(page, baseURL as string, finance.cookie);
  await page.goto(`/studio/reports?business=${businessId}`);
  await expect(
    page.getByText(
      "Harbour Beans's campaigns and their results are not shown to your role (Finance).",
    ),
  ).toBeVisible();
  await expect(page.getByText(/has no live, paused or ended campaigns/)).toBeHidden();
  await capture(page, "finance");
});
