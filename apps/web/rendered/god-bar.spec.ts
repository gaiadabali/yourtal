import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { clickUntilVisible, gotoSettled } from "./settle";

/**
 * The GOD bar on the signed-out pages (GOD-BAR-PLAN). Public landing and region pages carry the
 * switcher and the company link; the auth pages carry the link only. Nobody signed out sees Spambank.
 */
const GOD_URL = "https://god.gaiada.com";

for (const route of ["/au", "/id"]) {
  test(`${route} has the GOD switcher and company link, and no Spambank`, async ({ page }) => {
    await gotoSettled(page, route);
    const label = route === "/id" ? "Aplikasi GOD" : "GOD apps";
    const trigger = page.getByRole("button", { name: label });
    await expect(trigger.first()).toBeVisible();
    const link = page.getByRole("link", {
      name: route === "/id" ? "Bagian dari GOD" : "A GOD company",
    });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", GOD_URL);
    await clickUntilVisible(trigger.first(), page.getByRole("dialog", { name: label }));
    await expect(page.getByText("Spambank")).toHaveCount(0);
  });
}

test("/login has one main, a GOD company link, no switcher, and no landmark axe issues", async ({
  page,
}) => {
  await gotoSettled(page, "/login");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "A GOD company" })).toHaveAttribute("href", GOD_URL);
  await expect(page.getByRole("button", { name: "GOD apps" })).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.filter((v) => ["landmark-one-main", "region"].includes(v.id)).map((v) => v.id),
  ).toStrictEqual([]);
});
