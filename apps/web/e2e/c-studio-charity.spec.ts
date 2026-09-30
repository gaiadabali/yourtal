import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * 13.21 live, through the real UI: an AU adult registers a charity at
 * /charity/apply (the simulated KYB check runs in the API), ops approve it at
 * /staff/charities with a reason, it appears at /charities, and its member
 * opens the console. 390 and 1280 px, light and dark, axe clean. Runs under
 * `playwright.c-studio.config.ts`, like the other slot-local C specs.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name}: source this worktree's .env`);
  return value;
}

async function account(request: APIRequestContext, prefix: string) {
  const api = env("API_INTERNAL_URL");
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const password = "c-charity-not-a-real-secret-1";
  const registered = await request.post(`${api}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: `${prefix} E2E` },
      ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const login = await request.post(`${api}/api/auth/login`, { data: { email, password } });
  const body = (await login.json()) as { token: string; userId: string };
  return { token: body.token, userId: body.userId };
}

async function pageAs(browser: Browser, baseURL: string, token: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "yt_session", value: token, url: baseURL },
    { name: "yt_region", value: "AU", url: baseURL },
  ]);
  return context.newPage();
}

async function capture(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `test-results/c-charity-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

test("a charity applies, ops approve it, it lists, and its member opens the console", async ({
  browser,
  request,
  baseURL,
}) => {
  const pool = new Pool({ connectionString: env("DATABASE_OWNER_URL") });
  try {
    const applicant = await account(request, "c-charity-applicant");
    const ops = await account(request, "c-charity-ops");
    await pool.query(
      `INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, 'ops', 'c-charity-spec')
       ON CONFLICT DO NOTHING`,
      [ops.userId],
    );
    const name = `Harbour Kids ${String(Date.now()).slice(-5)}`;

    const page = await pageAs(browser, baseURL as string, applicant.token);
    await page.goto("/charity/apply");
    await page.getByLabel("Charity name").fill(name);
    await page.getByLabel("What your charity does").fill("Breakfast programmes in local schools.");
    await page.getByLabel("ABN").fill("51 824 753 556");
    await page.getByRole("switch", { name: "We are registered with the ACNC" }).click();
    await page.getByLabel("Account name").fill("Harbour Kids Ltd");
    await page.getByLabel("BSB").fill("062000");
    await page.getByLabel("Account number").fill("12345678");
    await capture(page, "apply");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("status")).toHaveText(/with our team for review/);

    const staffPage = await pageAs(browser, baseURL as string, ops.token);
    await staffPage.goto("/staff/charities");
    await expect(staffPage.getByRole("heading", { name })).toBeVisible();
    await capture(staffPage, "staff");
    const card = staffPage.getByRole("listitem").filter({ hasText: name });
    await card.getByRole("button", { name: "Approve" }).click();
    await staffPage.getByLabel(/reason/i).fill("ACNC register checked");
    await staffPage.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(staffPage.getByRole("heading", { name })).toBeHidden();

    const { rows } = await pool.query(
      `SELECT c.state, d.reason FROM charity.charity c JOIN charity.decision d ON d.charity_id = c.id
        WHERE c.name = $1`,
      [name],
    );
    expect(rows).toEqual([{ state: "approved", reason: "ACNC register checked" }]);

    await page.goto("/charities");
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await capture(page, "list");

    await page.goto("/charity/apply");
    await page.getByRole("link", { name: "Open console" }).first().click();
    await expect(page.getByRole("heading", { name: "Proceeds" })).toBeVisible();
    await capture(page, "console");
  } finally {
    await pool.end();
  }
});
