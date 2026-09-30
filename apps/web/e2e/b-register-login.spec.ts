import { randomUUID } from "node:crypto";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 6.2.a's own Check plus 6.2.c's, together: register (through the real
 * `/register` form) → onboarding (E's 6.2.b flat route chain — consent →
 * follow, interests skipped since personalize consent is never granted
 * here → done) → Home, in both regions, asserting Home's own real,
 * translated heading rather than only a URL. Also covers forgot/reset,
 * login and email verification against a real `apps/api`.
 *
 * Registers exactly FIVE accounts across the whole file (`auth.register` is
 * capped at 5/IP/hour, `REGISTER_RATE_LIMIT`) — the AU/ID pair below, plus
 * the neutral-age-gate describe block's own three attempts (12.4.d/#5: a
 * 14-year-old's two submits — the guardian step, then the real
 * completion — and a 12-year-old's one, the final refusal). Right at the
 * cap: add another register call to this file only if one of these is cut.
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

interface DevInboxEntry {
  readonly recipient: string;
  readonly category: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

/** Reads the token out of the newest matching simulated email (1.6.b's `/api/dev/inbox`) — the only way to complete a real reset/verify round trip here without a real mailbox. */
async function latestToken(
  request: APIRequestContext,
  recipient: string,
  category: "password_reset" | "email_verification",
): Promise<string> {
  const response = await request.get(`${apiBaseUrl()}/api/dev/inbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: DevInboxEntry[] };
  const matches = body.entries
    .filter((entry) => entry.recipient === recipient && entry.category === category)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  expect(matches.length, `no ${category} email found for ${recipient}`).toBeGreaterThan(0);
  const token = matches[0]?.metadata["token"];
  expect(typeof token).toBe("string");
  return token as string;
}

interface NewAccount {
  email: string;
  password: string;
  displayName: string;
}

function uniqueAccount(prefix: string): NewAccount {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `${prefix}-${id}@example.com`,
    password: "correct horse battery staple",
    displayName: `${prefix} ${id}`,
  };
}

/** ISO date (`YYYY-MM-DD`) for someone who turned `years` old within the last year — 1.4.b's own age bands. */
function isoDateYearsAgo(years: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return d.toISOString().slice(0, 10);
}

async function registerThroughUi(
  page: Page,
  account: NewAccount,
  region: "Australia" | "Indonesia",
  language: "English (Australia)" | "Bahasa Indonesia",
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Display name").fill(account.displayName);
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page.getByLabel("Region").selectOption({ label: region });
  await page.getByLabel("Language").selectOption({ label: language });
  await page.getByRole("button", { name: "Create account" }).click();
}

/**
 * 6.2.c's own copy, per display locale (E's 6.2.b, each locale's own
 * `onboarding.json`, and Home's `feed.json`) — enough to
 * drive the flat
 * onboarding route chain (consent → follow, interests skipped since
 * personalize consent is never granted here → done) and recognise Home by
 * its real, translated heading rather than a URL alone.
 */
const ONBOARDING_COPY = {
  "en-AU": {
    consentHeading: "Before you start",
    continueCta: "Continue",
    followCta: /Continue|Skip for now/,
    doneCta: "Start watching",
    homeHeading: "Home",
  },
  "id-ID": {
    consentHeading: "Sebelum kamu mulai",
    continueCta: "Lanjutkan",
    followCta: /Lanjutkan|Lewati dulu/,
    doneCta: "Mulai menonton",
    homeHeading: "Beranda",
  },
} as const;

/** 6.2.c's Check: consent (essential only, so interests is skipped) → follow (skipped) → done → Home, asserting Home's own real heading in the account's display locale. */
async function completeOnboardingToHome(page: Page, locale: "en-AU" | "id-ID"): Promise<void> {
  const copy = ONBOARDING_COPY[locale];

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: copy.consentHeading })).toBeVisible();
  await page.getByRole("button", { name: copy.continueCta }).click();

  await expect(page).toHaveURL(/\/onboarding\/follow/);
  await page.getByRole("button", { name: copy.followCta }).click();

  await expect(page).toHaveURL(/\/onboarding\/done/);
  await page.getByRole("link", { name: copy.doneCta }).click();

  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { level: 1, name: copy.homeHeading })).toBeVisible();
}

/** Where 12.4.d's screenshots land — see the task's own scratchpad path. */
const SCREENSHOT_DIR =
  "C:/Users/Hansel/AppData/Local/Temp/claude/c--Users-Hansel-Documents-Hansel-Projects-yourtal/8b7a9841-bc91-4309-8b6a-dca2ffbaf048/scratchpad/12.4.d";

function envUrl(name: string): string {
  const url = process.env[name];
  if (url === undefined || url === "") {
    throw new Error(`${name} is not set — source this worktree's .env before running this spec.`);
  }
  return url;
}

/**
 * One live, funded, all_ages AU campaign, seeded directly — the same shape
 * `apps/api`'s own e2e suites use (e.g.
 * `feed-teen-ending-soon.e2e.test.ts`) — so 12.4.d/#9's Sponsored label has
 * a real Home feed card to show up on, with no extra `auth.register` calls
 * (this file is already at its own 5/IP/hour cap).
 */
async function seedSponsoredCampaign(): Promise<{
  campaignId: string;
  cleanup: () => Promise<void>;
}> {
  const pool = new Pool({ connectionString: envUrl("DATABASE_URL") });
  const campaignId = randomUUID();
  const businessId = randomUUID();
  const allocationId = randomUUID();
  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
        published_at, business_id, region, audience, content_category, poster_url,
        teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
        teaser_start_seconds)
     VALUES
       ($1, 'quick', $2, $3, 'Sponsored Label Merchant', 'Exercises 12.4.d #9 screenshot.', 30,
        10, 100, 0, 'base_only', 'live', now(), $3, 'AU', 'all_ages', 'food-and-drink',
        'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
        'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
        now() + interval '30 days', false, 0)`,
    [campaignId, `Sponsored label e2e ${campaignId}`, businessId],
  );
  await pool.query(
    `INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
     VALUES ($1, 'hls', 'https://cdn.example.com/manifest.m3u8')`,
    [campaignId],
  );
  await pool.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, accuracy_bonus_points, effective_from)
     VALUES ($1, 1, 100, 0, 'base_only', 30, 0, now())`,
    [campaignId],
  );
  await pool.query(
    `INSERT INTO platform.ledger_fake_allocation
       (id, business_id, region, funder_type, currency, total_points, remaining_points)
     VALUES ($1, $2, 'AU', 'marketing', 'AUD', 10000, 10000)`,
    [allocationId, businessId],
  );
  await pool.query(
    `INSERT INTO campaign.reward_config
       (campaign_id, allocation_id, funder_type, max_points_for_campaign,
        reward_points_per_completion, accuracy_bonus_points)
     VALUES ($1, $2, 'marketing', 10000, 100, 0)`,
    [campaignId, allocationId],
  );
  return {
    campaignId,
    cleanup: async () => {
      // `campaign.terms_version` is insert-only for `yourtal_app` (the role
      // `DATABASE_URL` connects as) — same reasoning
      // `feed.controller.e2e.test.ts`'s own header gives for its `owner`
      // pool; cleanup needs the owner role.
      const owner = new Pool({ connectionString: envUrl("DATABASE_OWNER_URL") });
      try {
        await owner.query(`DELETE FROM campaign.reward_config WHERE campaign_id = $1`, [
          campaignId,
        ]);
        await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = $1`, [
          campaignId,
        ]);
        await owner.query(`DELETE FROM campaign.video_source WHERE campaign_id = $1`, [campaignId]);
        await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
        await owner.query(`DELETE FROM platform.ledger_fake_allocation WHERE id = $1`, [
          allocationId,
        ]);
      } finally {
        await owner.end();
        await pool.end();
      }
    },
  };
}

test.describe.serial("6.2.a: register, forgot/reset, login, verify — against a live api", () => {
  let auAccount: NewAccount;

  test("6.2.c: an AU account registered through the real form lands on /onboarding with a real session, region AU, locale en-AU, then reaches Home in English", async ({
    page,
    context,
  }) => {
    auAccount = uniqueAccount("b-au");
    await registerThroughUi(page, auAccount, "Australia", "English (Australia)");

    await expect(page).toHaveURL(/\/onboarding/);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "yt_session")?.value).toBeTruthy();
    expect(cookies.find((c) => c.name === "yt_region")?.value).toBe("AU");
    expect(cookies.find((c) => c.name === "yt_locale")?.value).toBe("en-AU");

    await completeOnboardingToHome(page, "en-AU");
  });

  test("6.2.c: an ID account registered through the real form gets region ID, locale id-ID, then reaches Home in Indonesian", async ({
    page,
    context,
  }) => {
    const account = uniqueAccount("b-id");
    await registerThroughUi(page, account, "Indonesia", "Bahasa Indonesia");

    await expect(page).toHaveURL(/\/onboarding/);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "yt_region")?.value).toBe("ID");
    expect(cookies.find((c) => c.name === "yt_locale")?.value).toBe("id-ID");

    await completeOnboardingToHome(page, "id-ID");
  });

  test("forgot password: a real reset link changes the password and signs the account in", async ({
    page,
    request,
  }) => {
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(auAccount.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/forgot\?sent=1/);
    await expect(page.getByText("Check your email")).toBeVisible();

    const token = await latestToken(request, auAccount.email, "password_reset");
    const newPassword = "battery staple correct horse 2";

    await page.goto(`/reset?token=${encodeURIComponent(token)}`);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();

    // `resetPasswordAction` signs the account straight in and redirects to
    // "/", which `route-redirects.ts` then sends on to "/home" for a
    // signed-in caller.
    await expect(page).toHaveURL(/\/home/);

    const oldLoginAttempt = await request.post(`${apiBaseUrl()}/api/auth/login`, {
      data: { email: auAccount.email, password: auAccount.password },
    });
    expect(oldLoginAttempt.status()).toBe(401);

    auAccount = { ...auAccount, password: newPassword };
  });

  test("sign in through the real /login form with the account's new password", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(auAccount.email);
    await page.getByLabel("Password").fill(auAccount.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/home/);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "yt_session")?.value).toBeTruthy();
  });

  test("verify email: a real confirm token marks the account's credential verified", async ({
    page,
    request,
    context,
  }) => {
    // Each test gets its own isolated context, so the session `login` set
    // two tests ago is gone here — sign in again, in THIS test's context,
    // through the real form rather than reaching for a cookie nothing set.
    await page.goto("/login");
    await page.getByLabel("Email").fill(auAccount.email);
    await page.getByLabel("Password").fill(auAccount.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/home/);

    const token = (await context.cookies()).find((c) => c.name === "yt_session")?.value;
    expect(token).toBeTruthy();

    const requested = await request.post(`${apiBaseUrl()}/api/auth/email/verify/request`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(requested.ok()).toBeTruthy();

    const verifyToken = await latestToken(request, auAccount.email, "email_verification");
    await page.goto(`/verify?token=${encodeURIComponent(verifyToken)}`);
    await page.getByRole("button", { name: "Verify email" }).click();

    await expect(page).toHaveURL(/verified=1/);
    await expect(page.getByText("Email verified")).toBeVisible();
  });

  // 12.4.d/#9: every campaign is funded by a business, so every Home feed
  // card says so, in plain text. Reuses `auAccount` (a plain login, not a
  // new `auth.register` call — this file is already at its own 5/IP/hour
  // cap) and seeds one live campaign directly, rather than depending on
  // whatever this dev database's own catalogue happens to already hold.
  test("Home shows a Sponsored label on a feed card", async ({ page }) => {
    const seeded = await seedSponsoredCampaign();
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(auAccount.email);
      await page.getByLabel("Password").fill(auAccount.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/home/);

      await expect(page.getByText("Sponsored").first()).toBeVisible();

      for (const viewport of [
        { name: "390", width: 390, height: 844 },
        { name: "1280", width: 1280, height: 800 },
      ]) {
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.emulateMedia({ colorScheme });
          await page.screenshot({
            path: path.join(
              SCREENSHOT_DIR,
              `sponsored-feed-card-${viewport.name}-${colorScheme}.png`,
            ),
          });
        }
      }
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(
        axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
      ).toStrictEqual([]);
    } finally {
      await seeded.cleanup();
    }
  });
});

/**
 * 12.4.d/#5: the neutral age gate. Needs `TEEN_ACCOUNTS=true` on the live
 * `apps/api` this config's `webServer` starts (see its own `env`) — a
 * 14-year-old's guardian step never appears with teen registration closed.
 */
test.describe("12.4.d/#5: the neutral age gate", () => {
  test("a 14-year-old sees no live age feedback, then the guardian step after submitting, then succeeds once a guardian email is given", async ({
    page,
  }) => {
    const account = uniqueAccount("b-teen14");
    await page.goto("/register");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByLabel("Display name").fill(account.displayName);
    await page.getByLabel("Date of birth").fill(isoDateYearsAgo(14));

    // Neutral: no guardian field, no age notice, before the form is submitted.
    // (Unit-tested more strictly, with no dev-only overlay noise, in
    // register-form.test.tsx's own "no computed age" case.)
    await expect(page.getByLabel(/parent or guardian/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/error=guardian_email_required/);
    await expect(
      page.getByText("A parent or guardian's email is required for your age."),
    ).toBeVisible();
    await expect(page.getByLabel(/parent or guardian/i)).toBeVisible();

    // Same form, every field resent — refilled defensively rather than
    // relying on whether the framework kept the earlier values in place.
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByLabel("Display name").fill(account.displayName);
    await page.getByLabel("Date of birth").fill(isoDateYearsAgo(14));
    await page.getByLabel(/parent or guardian/i).fill(`guardian-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("a 12-year-old gets a final refusal screen for that attempt — no form left to edit and resubmit", async ({
    page,
  }) => {
    const account = uniqueAccount("b-under13");
    await page.goto("/register");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByLabel("Display name").fill(account.displayName);
    await page.getByLabel("Date of birth").fill(isoDateYearsAgo(12));
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/error=too_young/);
    await expect(page.getByText("You can't create an account yet.")).toBeVisible();
    await expect(page.getByLabel("Date of birth")).toHaveCount(0);
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Start over" })).toBeVisible();
  });
});

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;

const SCREENS: readonly { name: string; path: string; heading: string }[] = [
  { name: "register", path: "/register", heading: "Join YourTal" },
  { name: "login", path: "/login", heading: "Welcome back" },
  { name: "forgot", path: "/forgot", heading: "Forgot your password?" },
  { name: "reset-missing-token", path: "/reset", heading: "Choose a new password" },
  { name: "verify-missing-token", path: "/verify", heading: "Verify your email" },
  // 12.4.d/#5: the two states the neutral age gate can leave the register
  // screen in — reached directly by URL (exactly what a fresh page load of
  // `registerAction`'s own redirect looks like), so no live api or account
  // is needed for these two screenshots.
  {
    name: "register-guardian-step",
    path: "/register?error=guardian_email_required",
    heading: "Join YourTal",
  },
  { name: "register-final-refusal", path: "/register?error=too_young", heading: "Join YourTal" },
  // 12.4.d/#3: the terms and privacy pages' new teen/guardian sections.
  { name: "terms", path: "/au/terms", heading: "Terms of use" },
  { name: "privacy", path: "/au/privacy", heading: "Privacy" },
];

for (const viewport of VIEWPORTS) {
  for (const colorScheme of THEMES) {
    test.describe(`${viewport.name}px, ${colorScheme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, colorScheme });

      for (const screen of SCREENS) {
        test(`${screen.name} renders and passes axe (WCAG AA)`, async ({ page }) => {
          await page.goto(screen.path);
          await expect(page.getByRole("heading", { name: screen.heading })).toBeVisible();
          await page.screenshot({
            path: `test-results/b-auth-${screen.name}-${viewport.name}-${colorScheme}.png`,
          });
          // 12.4.d's own evidence copy, alongside the usual test-results one.
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${screen.name}-${viewport.name}-${colorScheme}.png`),
          });
          const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
          expect(
            axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
          ).toStrictEqual([]);
        });
      }
    });
  }
}
