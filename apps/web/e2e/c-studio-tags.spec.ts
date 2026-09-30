import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * 13.11.a live: Studio's taxonomy tag picker on a listing (Inventory) and a
 * campaign (Targeting), saved over the real API, at 390 and 1280 px in light
 * and dark, axe clean. Runs under `playwright.c-studio.config.ts`.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

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
  const email = `c-tags-${suffix}@example.test`;
  const password = "c-studio-tags-not-a-real-secret-1";
  const registered = await request.post(`${api()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: "Tags E2E" },
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
      ...{ addressPostcode: "2000", roles: ["advertiser", "supplier"], region: "AU" },
      handle: `harbour-beans-${suffix}`.slice(0, 40),
    },
  });
  expect(business.ok(), await business.text()).toBeTruthy();
  const businessId = ((await business.json()) as { business: { id: string } }).business.id;
  return { cookie, businessId };
}

async function seedListing(request: APIRequestContext, owner: Owner) {
  const headers = { cookie: owner.cookie, "idempotency-key": crypto.randomUUID() };
  const location = await request.post(`${api()}/api/${owner.businessId}/store/locations`, {
    headers,
    data: { name: "Circular Quay", address: "1 Alfred St", district: "Sydney" },
  });
  expect(location.ok(), await location.text()).toBeTruthy();
  const { id: locationId } = (await location.json()) as { id: string };
  const listing = await request.post(`${api()}/api/${owner.businessId}/store/listings`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ merchantName: "Harbour Beans", title: "Flat white", description: "One coffee." },
      ...{ category: "food_beverage", locationIds: [locationId], faceValueMinor: 550 },
      ...{ settlementValueMinor: 300, stockTotal: 20, transferable: false },
      ...{ partialRedemptionPolicy: "single_use_forfeit", expiresAt: "2027-06-01T00:00:00.000Z" },
      ...{ status: "available", audience: "all_ages", contentCategory: "food-and-drink" },
      ...{ tags: ["coffee"], imageUrl: "https://cdn.example.com/flat-white.jpg" },
      ...{ channel: "in_store", partialRedemption: "single_use" },
    },
  });
  expect(listing.ok(), await listing.text()).toBeTruthy();
  return (await listing.json()) as { id: string };
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
        path: `test-results/c-studio-tags-${name}-${String(width)}-${colorScheme}.png`,
        fullPage: true,
      });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    }
  }
}

test("a listing's category and tags are picked from the taxonomy and saved", async ({
  page,
  request,
  baseURL,
}) => {
  const owner = await ownerWithBusiness(request);
  const listing = await seedListing(request, owner);
  await signIn(page, baseURL as string, owner.cookie);

  await page.goto(`/studio/inventory?business=${owner.businessId}`);
  await expect(page.getByText("Flat white")).toBeVisible();
  await page.getByRole("button", { name: "Edit category and tags for Flat white" }).click();
  await page.getByRole("button", { name: "Bakery", exact: true }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await capture(page, "inventory");

  const saved = await request.get(`${api()}/api/${owner.businessId}/store/listings/${listing.id}`, {
    headers: { cookie: owner.cookie },
  });
  expect(((await saved.json()) as { tags: string[] }).tags).toEqual(["coffee", "bakery"]);
});

test("a campaign's tags are picked in Targeting and saved on close", async ({
  page,
  request,
  baseURL,
}) => {
  const owner = await ownerWithBusiness(request);
  await signIn(page, baseURL as string, owner.cookie);
  await page.goto(`/studio/campaigns?business=${owner.businessId}`);
  await page.getByRole("button", { name: /new campaign/i }).click();
  await page.getByRole("tab", { name: "Targeting" }).click();
  await page.getByRole("button", { name: "Specialty coffee", exact: true }).click();
  await page.getByRole("button", { name: "Bakery", exact: true }).click();
  await expect(page.getByText("2 of 8 picked")).toBeVisible();
  await capture(page, "campaign-targeting");

  await page
    .getByRole("button", { name: /back|close/i })
    .first()
    .click();
  // The editor saves on the way out; poll the API until the PATCH has landed.
  await expect
    .poll(async () => {
      const drafts = await request.get(`${api()}/api/${owner.businessId}/studio/campaigns`, {
        headers: { cookie: owner.cookie },
      });
      return ((await drafts.json()) as { declaredInterests: string[] }[])[0]?.declaredInterests;
    })
    .toEqual(["coffee-specialty", "bakery"]);
});
