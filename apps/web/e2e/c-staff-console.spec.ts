import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

/**
 * TASKS.md 9.1.b's Check against a live api + web on this slot: a non-staff
 * account gets 403 on `/staff`, no session is sent to sign in, and a staff
 * member granted a role by the real `pnpm staff:add` CLI gets the console.
 * Screenshots at 390 and 1280 px, light and dark, each axe-checked.
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
  const email = `c-staff-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff E2E",
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

/** The real CLI, exactly as a person with database access would run it. */
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

test.describe.serial("9.1: staff console access", () => {
  let viewer: LiveAccount;
  let staff: LiveAccount;

  test.beforeAll(async ({ request }) => {
    viewer = await registerAndLogIn(request, "viewer");
    staff = await registerAndLogIn(request, "ops");
    staffAdd(staff.email, "ops");
    staffAdd(staff.email, "support");
  });

  test("no session is sent to sign in", async ({ page }) => {
    await page.goto("/staff");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fstaff/);
  });

  test("a non-staff account gets 403", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, viewer.token);
    const response = await page.goto("/staff");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1, name: "No access" })).toBeVisible();
    await expectAxeClean(page);
    await page.screenshot({ path: "test-results/c-staff-forbidden.png", fullPage: true });
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`staff see the console at ${String(width)}px, ${colorScheme}`, async ({
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
        const response = await page.goto("/staff");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
        await expect(page.getByText(staff.email)).toHaveCount(2);
        await expect(page.getByText("Operations")).toBeVisible();
        await expect(page.getByText("Support")).toBeVisible();
        await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-overview-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
