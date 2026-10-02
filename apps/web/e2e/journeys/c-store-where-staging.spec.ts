import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * 13.17.a, C half (13.12.e) on staging: the store's "Where to use it" filter
 * is applied by the API, so the page's result count is the server's
 * `total_count`. Run with JOURNEY_BASE_URL=https://yourtal.gaiada.com; it registers
 * one fresh viewer per region.
 */
const BASE = process.env["JOURNEY_BASE_URL"] ?? "https://yourtal.gaiada.com";
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const region of ["AU", "ID"] as const) {
  test(`${region}: Where to use it is filtered and counted on the server`, async ({
    browser,
    request,
  }) => {
    // One viewer per region, reused across runs (sign-up is rate limited per IP).
    // STORE_CHECK_PASSWORD comes from the runner's environment, never this file.
    const password = process.env["STORE_CHECK_PASSWORD"] ?? "";
    expect(password, "set STORE_CHECK_PASSWORD").not.toBe("");
    const email = `c-store-where-${region.toLowerCase()}@example.test`;
    let auth = await request.post(`${BASE}/api/auth/login`, { data: { email, password } });
    if (!auth.ok()) {
      auth = await request.post(`${BASE}/api/auth/register`, {
        headers: { "idempotency-key": crypto.randomUUID() },
        data: {
          ...{ email, password, region, displayName: "Store check", dateOfBirth: "1990-01-01" },
          locale: region === "AU" ? "en-AU" : "id-ID",
          timezone: region === "AU" ? "Australia/Sydney" : "Asia/Jakarta",
        },
      });
    }
    expect(auth.ok(), await auth.text()).toBeTruthy();
    const { token } = (await auth.json()) as { token: string };
    // Counted as this signed-in adult, who also sees adult-rated listings.
    const api = async (where: string) =>
      (
        (await (
          await request.get(`${BASE}/api/store/listings?limit=1${where}`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json()) as { total_count: number }
      ).total_count;
    const all = await api("");
    const inStore = await api("&channel=in_store");
    const online = await api("&channel=online");
    expect(inStore + online).toBeGreaterThanOrEqual(all);

    const context = await browser.newContext();
    await context.addCookies([{ name: "yt_session", value: token, url: BASE }]);
    const page = await context.newPage();
    for (const [where, expected] of [
      ["in_store", inStore],
      ["online", online],
    ] as const) {
      await page.goto(`${BASE}/store?where=${where}`);
      // The count line (store.json `count`): "17 rewards", "17 reward", or the zero form.
      const line =
        expected === 0
          ? /^(No rewards|Tidak ada reward)$/
          : new RegExp(`^${String(expected)} rewards?$`);
      await expect(page.getByText(line)).toBeVisible();
      for (const colorScheme of ["light", "dark"] as const) {
        for (const width of [390, 1280]) {
          await page.emulateMedia({ colorScheme });
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({
            path: `test-results/c-staging-store-${region}-${where}-${String(width)}-${colorScheme}.png`,
            fullPage: true,
          });
          const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
          expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
        }
      }
    }
    await context.close();
  });
}
