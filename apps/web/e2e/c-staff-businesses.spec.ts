import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

/**
 * TASKS.md 9.3.a's Check, over a live api + web on this slot: a business
 * made through the real API, its KYB document uploaded for real (a genuine
 * presigned PUT to this slot's own object store, the same round trip the
 * Studio onboarding flow drives -- 7.1.b), an `ops` staffer reviewing it
 * and suspending/reinstating it through `/staff/businesses`'s real UI.
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
  const email = `c-staff-biz-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Businesses E2E",
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

/** A real business, created through the real API, owned by `owner`. */
async function createBusiness(request: APIRequestContext, owner: LiveAccount): Promise<string> {
  const handle = `c-staff-biz-${Date.now()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: {
      cookie: `yt_session=${owner.token}`,
      "idempotency-key": crypto.randomUUID(),
    },
    data: {
      legalName: "Staff Businesses E2E Pty Ltd",
      displayName: "Staff Businesses E2E Co",
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser"],
      region: "AU",
      handle,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { business: { id: string } };
  return body.business.id;
}

/** The real 7.1.b round trip: mint a presigned URL, PUT real bytes, then record the submission. */
async function submitKybDocument(
  request: APIRequestContext,
  owner: LiveAccount,
  businessId: string,
): Promise<void> {
  const minted = await request.post(`${apiBaseUrl()}/api/${businessId}/business/kyb-documents/upload-url`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: { contentType: "application/pdf" },
  });
  expect(minted.ok(), await minted.text()).toBeTruthy();
  const { storageRef, uploadUrl } = (await minted.json()) as {
    storageRef: string;
    uploadUrl: string;
  };

  const uploaded = await request.put(uploadUrl, {
    headers: { "content-type": "application/pdf" },
    data: Buffer.from("%PDF-1.4 c-staff-businesses.spec.ts fixture\n"),
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();

  const submitted = await request.post(`${apiBaseUrl()}/api/${businessId}/business/kyb-documents`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      documentType: "business_registration_certificate",
      storageRef,
      expiresAt: null,
    },
  });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
}

test.describe.serial("9.3.a: staff review of businesses", () => {
  let owner: LiveAccount;
  let staff: LiveAccount;
  let businessId: string;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "owner");
    staff = await registerAndLogIn(request, "ops");
    staffAdd(staff.email, "ops");
    businessId = await createBusiness(request, owner);
    await submitKybDocument(request, owner, businessId);
  });

  test("the business appears in the staff list, unverified", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, staff.token);
    await page.goto("/staff/businesses");
    await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
    // DataTable renders both a desktop <table> and a mobile <ul> at once
    // (CSS picks which is visible), so every cell's content matches twice.
    await expect(page.getByRole("link", { name: "Staff Businesses E2E Co" }).first()).toBeVisible();
    await expect(page.getByText("Unverified").first()).toBeVisible();
    await page.close();
  });

  test("staff approves the KYB submission, and the business becomes verified", async ({
    browser,
    baseURL,
  }) => {
    const page = await pageAs(browser, baseURL as string, staff.token);
    await page.goto(`/staff/businesses/${businessId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Staff Businesses E2E Co" })).toBeVisible();
    await expect(page.getByText("Awaiting review")).toBeVisible();

    await page.getByRole("button", { name: "Approve KYB" }).click();
    await page.getByLabel("Reason (required, for the record)").fill("Documents check out.");
    await page.getByRole("button", { name: "Approve KYB", exact: true }).last().click();

    await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();
    await page.close();
  });

  test("staff suspends then reinstates the business", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, staff.token);
    await page.goto(`/staff/businesses/${businessId}`);

    await page.getByRole("button", { name: "Suspend business" }).click();
    await page.getByLabel("Reason (required, for the record)").fill("Fraudulent listings reported.");
    await page.getByRole("button", { name: "Suspend", exact: true }).click();
    await expect(page.getByText("Suspended: Fraudulent listings reported.")).toBeVisible();

    await page.getByRole("button", { name: "Reinstate business" }).click();
    await page.getByLabel("Reason (required, for the record)").fill("Appeal upheld.");
    await page.getByRole("button", { name: "Reinstate", exact: true }).click();
    await expect(page.getByText("This business is active.")).toBeVisible();
    await page.close();
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`the businesses list renders at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([{ name: "yt_session", value: staff.token, url: baseURL as string }]);
        const page = await context.newPage();
        const response = await page.goto("/staff/businesses");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-businesses-list-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });

      test(`the business detail page renders at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([{ name: "yt_session", value: staff.token, url: baseURL as string }]);
        const page = await context.newPage();
        const response = await page.goto(`/staff/businesses/${businessId}`);
        expect(response?.status()).toBe(200);
        await expect(
          page.getByRole("heading", { level: 1, name: "Staff Businesses E2E Co" }),
        ).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-businesses-detail-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
