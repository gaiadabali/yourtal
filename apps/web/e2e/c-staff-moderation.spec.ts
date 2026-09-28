import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

/**
 * TASKS.md 9.2.c's Check, over a live api + web on this slot: a business,
 * listing and voucher-batch request made through the real API, a
 * `moderator` staffer reviewing it through `/staff/moderation`'s real UI --
 * only the voucher-batch half of the moderation queue (9.2.a's the rest,
 * waiting on 7.3). Screenshots at 390 and 1280 px, light and dark, each
 * axe-checked.
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
  const email = `c-staff-mod-${tag}-${Date.now()}@example.test`;
  const password = "c-staff-not-a-real-secret-1";
  const registered = await request.post(`${apiBaseUrl()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      email,
      password,
      region: "AU",
      locale: "en-AU",
      displayName: "Staff Moderation E2E",
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
  const handle = `c-staff-mod-${Date.now()}`;
  const created = await request.post(`${apiBaseUrl()}/api/businesses`, {
    headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
    data: {
      legalName: "Staff Moderation E2E Pty Ltd",
      displayName: "Staff Moderation E2E Co",
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

async function createListing(
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
      merchantName: "Staff Moderation E2E Co",
      title: "Staff Moderation E2E Listing",
      description: "Exercises the staff voucher-batch approval UI.",
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
      audience: "all_ages",
      contentCategory: "food-and-drink",
      imageUrl: "https://cdn.example.com/listing.jpg",
      channel: "in_store",
      partialRedemption: "single_use",
    },
  });
  expect(listing.ok(), await listing.text()).toBeTruthy();
  const { id: listingId } = (await listing.json()) as { id: string };
  return listingId;
}

async function requestVoucherBatch(
  request: APIRequestContext,
  owner: LiveAccount,
  businessId: string,
  listingId: string,
): Promise<void> {
  const requested = await request.post(
    `${apiBaseUrl()}/api/${businessId}/store/voucher-batch-requests`,
    {
      headers: { cookie: `yt_session=${owner.token}`, "idempotency-key": crypto.randomUUID() },
      data: { listingId, quantity: 5, reason: "Restocking for a promotion." },
    },
  );
  expect(requested.ok(), await requested.text()).toBeTruthy();
}

test.describe.serial("9.2.c: staff moderation of voucher-batch requests", () => {
  let owner: LiveAccount;
  let staff: LiveAccount;

  test.beforeAll(async ({ request }) => {
    owner = await registerAndLogIn(request, "owner");
    staff = await registerAndLogIn(request, "moderator");
    staffAdd(staff.email, "moderator");
    const businessId = await createBusiness(request, owner);
    const listingId = await createListing(request, owner, businessId);
    await requestVoucherBatch(request, owner, businessId, listingId);
  });

  // Screenshots first, while the pending request still exists -- the
  // approve test below removes it, and "Nothing pending" is a less useful
  // picture than a populated queue.
  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`the moderation queue renders at ${String(width)}px, ${colorScheme}`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
        });
        await context.addCookies([{ name: "yt_session", value: staff.token, url: baseURL as string }]);
        const page = await context.newPage();
        const response = await page.goto("/staff/moderation");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Moderation" })).toBeVisible();
        await expect(page.getByText("Restocking for a promotion.")).toBeVisible();
        await expectAxeClean(page);
        await page.screenshot({
          path: `test-results/c-staff-moderation-${String(width)}-${colorScheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }

  test("a moderator approves the pending request", async ({ browser, baseURL }) => {
    const page = await pageAs(browser, baseURL as string, staff.token);
    await page.goto("/staff/moderation");
    await expect(page.getByRole("heading", { level: 1, name: "Moderation" })).toBeVisible();
    await expect(page.getByText("Restocking for a promotion.")).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByLabel("Reason (required, for the record)").fill("Stock request looks legitimate.");
    await page.getByRole("button", { name: "Approve batch" }).click();

    await expect(page.getByText("Restocking for a promotion.")).toHaveCount(0);
    await expect(page.getByText("Nothing pending")).toBeVisible();
    await page.close();
  });
});
