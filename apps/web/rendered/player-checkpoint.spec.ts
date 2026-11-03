import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSettled } from "./settle";

/**
 * V6 / V11 of the 2026-10-21 walkthrough: at 390 px the checkpoint question was
 * clipped inside the video box (third option and the "28s left" line cut off,
 * the title cut at the top in Bahasa). `/lab/player` renders the real question
 * in the watch page's own stage with long options, in both languages.
 */
const LOCALES = ["en-AU", "id-ID"] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  expect(found, "has a layout box").not.toBeNull();
  return found as Box;
}

function within(inner: Box, outer: Box, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

function sections(page: Page, locale: (typeof LOCALES)[number]) {
  const stage = page.getByTestId(`stage-${locale}`);
  return {
    stage,
    video: page.getByTestId(`video-${locale}`),
    dialog: stage.getByRole("dialog"),
  };
}

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    test.describe(`checkpoint question, ${locale}, ${viewport.width}px`, () => {
      test.use({ viewport });

      test("every part of it is visible inside the page, none of it clipped", async ({ page }) => {
        await gotoSettled(page, "/lab/player");
        const { dialog, video } = sections(page, locale);
        await expect(dialog).toBeVisible();
        const dialogBox = await box(dialog);
        const pageWidth = viewport.width;

        // Nothing sideways: the question fits the column.
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(pageWidth);
        const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        // The progress line, the timer, the title and each option all sit fully
        // inside the question's own box: nothing is cut off by an overflow edge.
        const parts = [
          dialog.getByText(/^(Question 1 of 1|Pertanyaan 1 dari 1)$/),
          dialog.getByRole("timer"),
          dialog.getByRole("heading"),
          ...(await dialog.getByRole("radio").all()),
        ];
        expect(parts.length).toBe(6);
        for (const part of parts) {
          await expect(part).toBeVisible();
          expect(within(await box(part), dialogBox)).toBe(true);
        }

        const videoBox = await box(video);
        if (viewport.width < 640) {
          // On a phone it sits under the picture, never on it.
          expect(dialogBox.y).toBeGreaterThanOrEqual(videoBox.y + videoBox.height - 1);
        } else {
          // Wide enough to cover the picture, exactly.
          expect(within(dialogBox, videoBox, 2)).toBe(true);
          expect(within(videoBox, dialogBox, 2)).toBe(true);
        }
      });

      test("an option is large enough to tap and the whole question can be reached", async ({
        page,
      }) => {
        await gotoSettled(page, "/lab/player");
        const { dialog } = sections(page, locale);
        for (const option of await dialog.getByRole("radio").all()) {
          await option.scrollIntoViewIfNeeded();
          expect((await box(option)).height).toBeGreaterThanOrEqual(44);
        }
      });
    });
  }
}
