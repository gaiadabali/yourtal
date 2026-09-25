import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

async function expectInsideViewport(page: Page, target: Locator) {
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "overlay has a layout box").not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

for (const viewport of VIEWPORTS) {
  test.describe(`overlays at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("a dialog opens inside the viewport", async ({ page }) => {
      await page.goto("/lab/ui");
      await page.getByRole("button", { name: "Open dialog" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expectInsideViewport(page, dialog);
    });

    test("a select's list opens inside the viewport", async ({ page }) => {
      await page.goto("/lab/ui");
      await page.getByRole("combobox", { name: "Role" }).click();
      const list = page.getByRole("listbox");
      await expect(list).toBeVisible();
      await expectInsideViewport(page, list);
    });
  });
}
