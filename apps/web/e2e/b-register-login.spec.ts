import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 6.2.a's own Check plus the live half of 6.2.c (this spec proves the
 * register/login/forgot/reset/verify round trips against a real
 * `apps/api`; "lands on Home in the right language" is 6.2.c's own Check,
 * blocked on agent E's onboarding merging so `/onboarding`'s "done" step
 * actually redirects to `returnTo` — see `playwright.b-auth.config.ts`'s
 * header and this worktree's report for what that leaves open).
 *
 * Registers exactly TWO accounts (`auth.register` is capped at 5/IP/hour,
 * `REGISTER_RATE_LIMIT`) — the AU one is reused across the reset, login and
 * verify tests below rather than arranging a fresh one for each.
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

test.describe.serial("6.2.a: register, forgot/reset, login, verify — against a live api", () => {
  let auAccount: NewAccount;

  test("an AU account registered through the real form lands on /onboarding with a real session, region AU, locale en-AU", async ({
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
  });

  test("an ID account registered through the real form gets region ID, locale id-ID", async ({
    page,
    context,
  }) => {
    const account = uniqueAccount("b-id");
    await registerThroughUi(page, account, "Indonesia", "Bahasa Indonesia");

    await expect(page).toHaveURL(/\/onboarding/);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "yt_region")?.value).toBe("ID");
    expect(cookies.find((c) => c.name === "yt_locale")?.value).toBe("id-ID");
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
          const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
          expect(
            axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
          ).toStrictEqual([]);
        });
      }
    });
  }
}
