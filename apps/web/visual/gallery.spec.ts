import { expect, test } from "@playwright/test";

const WIDTHS = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 900 } } as const;
const THEMES = ["light", "dark"] as const;

/**
 * TASKS.md 3.6.b — a `toHaveScreenshot` baseline for every primitive family
 * in the gallery, at 390px and 1280px, light and dark, viewer surface.
 *
 * Section ids are read from the DOM (`[data-testid^="gallery-"]`) rather
 * than hard-coded, so a new `GallerySection` (3.4/3.5/3.6.a's brand section
 * included) is covered the next time this runs without editing this file.
 * One screenshot per SECTION, not the whole page — the gallery is long, and
 * a smaller crop keeps the committed PNGs small and pinpoints which
 * primitive family actually changed.
 */
for (const theme of THEMES) {
  for (const [widthLabel, viewport] of Object.entries(WIDTHS)) {
    test.describe(`gallery at ${widthLabel}px, ${theme}`, () => {
      test.use({ viewport });

      test(`every primitive section matches its baseline`, async ({ page }) => {
        await page.goto(`/lab/ui?theme=${theme}&surface=viewer`);
        await page.evaluate(() => document.fonts.ready);
        // The sticky gallery header would sit over each section's heading in its shot.
        await page.addStyleTag({
          content: "[data-gallery-chrome] { position: static !important; }",
        });

        const sections = page.locator('[data-testid^="gallery-"]');
        const count = await sections.count();
        expect(count, "the gallery should render at least one section").toBeGreaterThan(0);

        for (let index = 0; index < count; index += 1) {
          const section = sections.nth(index);
          const testId = await section.getAttribute("data-testid");
          const id = (testId ?? `section-${index}`).replace(/^gallery-/, "");

          // Videos (VerticalFeed's teasers, VideoSurface's <video>) never
          // finish loading in the gallery on purpose (see groups/video.tsx)
          // so their decoded frame is nondeterministic; mask rather than
          // rely on that. `animations: "disabled"` in the config already
          // freezes the loading Button's CSS spinner (groups/actions.tsx),
          // so nothing else here needs masking.
          const videos = await section.locator("video").all();

          await expect(section).toHaveScreenshot(`${id}-${widthLabel}-${theme}.png`, {
            mask: videos,
          });
        }
      });
    });
  }
}
