import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 1.7.e's Check, against a LIVE `apps/api` (see `playwright.a-identity.config.ts`
 * for why this spec has its own config): a Server Component shows the
 * signed-in user's name through a real `apiFetch` call, and `/wallet`
 * without a session redirects to `/login`.
 *
 * Every step is a real HTTP round trip: `POST /api/auth/register` directly
 * (arranging an account is not this ticket's job — `loginAction` is), then
 * a real browser submit of `/dev/login`'s form (1.7.b's `loginAction`),
 * then a real `GET /api/me` behind `/dev/whoami` (1.7.a's `apiFetch`).
 *
 * Registers exactly ONE account, in `beforeAll`, and reuses it everywhere
 * below through `loginAction` — `auth.register` is capped at 5 per IP per
 * hour (`REGISTER_RATE_LIMIT`), which a fresh registration per test/theme
 * combination blows through immediately. `auth.login` (30 per 15 min) has
 * plenty of headroom for the handful of sign-ins this file does.
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

interface TestAccount {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

function uniqueTestAccount(): TestAccount {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `dev-e2e-${id}@example.com`,
    password: "correct horse battery staple",
    displayName: `E2E Ada ${id}`,
  };
}

async function registerAccount(request: APIRequestContext, account: TestAccount): Promise<void> {
  const response = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      email: account.email,
      password: account.password,
      region: "AU",
      locale: "en-AU",
      displayName: account.displayName,
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    },
  });
  expect(response.ok(), `register failed: ${await response.text()}`).toBeTruthy();
}

/** Drives the real `/dev/login` form (loginAction, 1.7.b) — no cookie is ever set by hand. */
async function signInThroughLoginAction(
  page: Page,
  account: TestAccount,
  returnTo: string,
): Promise<void> {
  await page.goto(`/dev/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

let sharedAccount: TestAccount;

test.beforeAll(async ({ request }) => {
  sharedAccount = uniqueTestAccount();
  await registerAccount(request, sharedAccount);
});

test.describe("1.7.e: web/API identity plumbing against a live api", () => {
  test("sign in through loginAction, and apiFetch renders the real display name", async ({
    page,
  }) => {
    await signInThroughLoginAction(page, sharedAccount, "/dev/whoami");

    await expect(page).toHaveURL(/\/dev\/whoami$/);
    await expect(page.getByTestId("whoami-name")).toHaveText(
      `Signed in as: ${sharedAccount.displayName}`,
    );
  });

  test("/dev/whoami with no session reports anonymous, not a crash", async ({ page }) => {
    await page.goto("/dev/whoami");
    await expect(page.getByTestId("whoami-anonymous")).toBeVisible();
  });

  test("/wallet without a session redirects to /login?returnTo=/wallet", async ({ page }) => {
    await page.goto("/wallet");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("returnTo")).toBe("/wallet");
  });

  test("a session cookie alone is not enough for /merchant — it needs yt_device, not yt_session", async ({
    page,
  }) => {
    await signInThroughLoginAction(page, sharedAccount, "/dev/whoami");
    await expect(page).toHaveURL(/\/dev\/whoami$/);

    await page.goto("/merchant/devices");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/merchant/pair");
  });
});

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;

for (const viewport of VIEWPORTS) {
  for (const colorScheme of THEMES) {
    test.describe(`${viewport.name}px, ${colorScheme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, colorScheme });

      test(`/dev/login and /dev/whoami render and pass axe (WCAG AA)`, async ({ page }) => {
        await page.goto("/dev/login?returnTo=%2Fdev%2Fwhoami");
        await expect(page.getByRole("heading", { name: "Dev login" })).toBeVisible();
        await page.screenshot({
          path: `test-results/a-identity-login-${viewport.name}-${colorScheme}.png`,
        });
        const loginAxe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          loginAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toStrictEqual([]);

        await signInThroughLoginAction(page, sharedAccount, "/dev/whoami");
        await expect(page).toHaveURL(/\/dev\/whoami$/);
        await expect(page.getByTestId("whoami-name")).toHaveText(
          `Signed in as: ${sharedAccount.displayName}`,
        );
        await page.screenshot({
          path: `test-results/a-identity-whoami-${viewport.name}-${colorScheme}.png`,
        });
        const whoamiAxe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          whoamiAxe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toStrictEqual([]);
      });
    });
  }
}
