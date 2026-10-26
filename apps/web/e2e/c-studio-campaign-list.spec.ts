import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * 5.13.h live: at 390 px a campaign whose title wraps keeps its status badge inside its
 * own row, clear of the tag chips below it (it used to spill onto them). Runs under
 * `playwright.c-studio.config.ts`.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function api(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") throw new Error("source this worktree's .env first");
  return url;
}

test("a long campaign title wraps without its status badge landing on the tags", async ({
  page,
  request,
  baseURL,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `c-list-${suffix}@example.test`;
  const password = "c-studio-list-not-a-real-secret-1";
  await request.post(`${api()}/api/auth/register`, {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ email, password, region: "AU", locale: "en-AU", displayName: "List E2E" },
      ...{ dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
    },
  });
  const login = await request.post(`${api()}/api/auth/login`, { data: { email, password } });
  const { token } = (await login.json()) as { token: string };
  const headers = { cookie: `yt_session=${token}` };
  const business = await request.post(`${api()}/api/businesses`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ legalName: "Harbour Beans Pty Ltd", displayName: "Harbour Beans" },
      ...{ taxIdKind: "ABN", taxIdValue: "51824753556", addressState: "NSW" },
      ...{ addressPostcode: "2000", roles: ["advertiser"], region: "AU" },
      handle: `list-${suffix}`.slice(0, 40),
    },
  });
  const businessId = ((await business.json()) as { business: { id: string } }).business.id;
  const created = await request.post(`${api()}/api/${businessId}/studio/campaigns`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: {
      ...{ kind: "quick", title: "Snap App — Weekend Special", synopsis: "A synopsis." },
      ...{ durationSeconds: 60, contentCategory: "food-and-drink", audience: "all_ages" },
      ...{ startsAt: new Date().toISOString(), openViewing: false, teaserStartSeconds: 0 },
      ...{ endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      declaredInterests: ["coffee", "bakery", "restaurants", "street-food"],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  const [name, value] = headers.cookie.split("=");
  await page
    .context()
    .addCookies([{ name: name as string, value: value as string, url: baseURL as string }]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/studio/campaigns?business=${businessId}`);
    const row = page.getByRole("listitem").filter({ hasText: "Snap App — Weekend Special" });
    const badge = row.getByText("Draft", { exact: true });
    const firstTag = row
      .getByRole("button", { name: "Coffee", exact: true })
      .or(row.getByText("Coffee", { exact: true }));
    const badgeBox = await badge.boundingBox();
    const tagBox = await firstTag.first().boundingBox();
    expect(badgeBox).not.toBeNull();
    expect(tagBox).not.toBeNull();
    expect((badgeBox?.y ?? 0) + (badgeBox?.height ?? 0)).toBeLessThanOrEqual(tagBox?.y ?? 0);
    await page.screenshot({
      path: `test-results/c-studio-campaign-list-390-${colorScheme}.png`,
      fullPage: true,
    });
    const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
  }
});
