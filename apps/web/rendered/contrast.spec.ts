import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { GATE_ROUTES, THEMES } from "./routes";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const colorScheme of THEMES) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const route of GATE_ROUTES) {
      test(`${route} has no axe violations`, async ({ page }) => {
        await page.goto(route);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toStrictEqual([]);
      });
    }

    test("an open dialog has no axe violations", async ({ page }) => {
      await page.goto("/lab/ui");
      await page.getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(violations.map((v) => v.id)).toStrictEqual([]);
    });
  });
}
