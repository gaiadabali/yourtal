import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

/**
 * TASKS.md 9.2.a: the listing half of `/staff/moderation`, over a live
 * api + web on this slot. Only a listing the automated screen flags (an
 * `adult_only` contentCategory, per 1.1.d) ever reaches this queue -- an
 * ordinary listing is `active` from creation and never appears here at
 * all, which `staff-listing-moderation.e2e.test.ts` already proves at the
 * API layer. This spec is the UI half: an `ops` staffer reviews and
 * decides through the real `/staff/moderation` page.
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
  const email = `c-staff-lm-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Listing Moderation E2E",
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

async function createBusiness(request: APIRequestContext, owner: LiveAccount): Promise<string> {
  const handle = `c-staff-lm-${Date.now()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      legalName: "Staff Listing Moderation E2E Pty Ltd",
      displayName: "Staff Listing Moderation E2E Co",
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

/** Flagged for review by the automated screen: `alcohol` is adult_only in AU (1.1.d). */
async function createFlaggedListing(
  request: APIRequestContext,
  owner: LiveAccount,
  businessId: string,
): Promise<string> {
  const location = await request.post(`${apiBaseUrl()}/api/${businessId}/store/locations`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: { name: "E2E Outlet", address: "1 Test St", district: "Testville" },
  });
  expect(location.ok(), await location.text()).toBeTruthy();
  const { id: locationId } = (await location.json()) as { id: string };

  const listing = await request.post(`${apiBaseUrl()}/api/${businessId}/store/listings`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      merchantName: "Staff Listing Moderation E2E Co",
      title: `Flagged Listing ${Date.now()}`,
      description: "Exercises the staff listing moderation UI.",
      category: "retail",
      locationIds: [locationId],
      faceValueMinor: 10_000,
      settlementValueMinor: 3_000,
      stockTotal: 10,
      transferable: false,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendMinor: null,
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "available",
      audience: "adult",
      contentCategory: "alcohol",
      imageUrl: "https://cdn.example.com/listing.jpg",
      channel: "in_store",
      partialRedemption: "single_use",
    },
  });
  expect(listing.ok(), await listing.text()).toBeTruthy();
  const { id, title } = (await listing.json()) as { id: string; title: string };
  return `${id}::${title}`;
}

test.describe.serial("9.2.a: staff listing moderation, through the real UI", () => {
  let owner: LiveAccount;
  let staff: LiveAccount;
  let listingTitle: string;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "owner");
    staff = await registerAndLogIn(request, "ops");
    staffAdd(staff.email, "ops");
    const businessId = await createBusiness(request, owner);
    const [, title] = (await createFlaggedListing(request, owner, businessId)).split("::");
    listingTitle = title as string;
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`the listing moderation queue renders at ${String(width)}px, ${colorScheme}`, async ({
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
        await expect(page.locator(":visible", { hasText: listingTitle }).first()).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-listing-moderation-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }

  test("an ops staffer approves the flagged listing", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, staff.token);
    await page.goto("/staff/moderation");
    await expect(page.locator(":visible", { hasText: listingTitle }).first()).toBeVisible();

    const row = page.locator("tr, li").filter({ hasText: listingTitle }).first();
    await row.getByRole("button", { name: "Approve" }).click();
    await page
      .getByLabel("Reason (required, for the record)")
      .fill("adult_only category correctly declared, approved.");
    await page.getByRole("button", { name: "Approve listing" }).click();
    await expect(page.getByText(listingTitle)).toHaveCount(0);
    await page.close();
  });
});
