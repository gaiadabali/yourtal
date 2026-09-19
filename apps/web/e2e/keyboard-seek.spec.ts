import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { LONG_FORM_CAMPAIGN_ID } from "./fixture-ids";

/**
 * YT-0412's keyboard-seeking criterion. `features/player/seek-slider.tsx`
 * is a native `<input type="range">` — ArrowLeft/ArrowRight/Home/End
 * seeking is browser-implemented platform behaviour that jsdom does not
 * provide (its `<input>` accepts a `value` but has no keyboard event
 * wiring at all), which is exactly why this moved out of Vitest and into
 * a real Chrome. The old Radix Slider tested its own JS keyboard handling
 * under jsdom; this tests the app's actual control.
 *
 * The slider's displayed value is driven by real playback position
 * (`session.virtualCurrentTime` in `use-watch-session.ts`), not by an
 * independent "seek target" state — `handleSeekTo` writes straight to
 * `video.currentTime` and no-ops into a pending ref if the video has no
 * finite `duration` yet. So a keyboard press only visibly sticks once the
 * underlying `<video>` has actually loaded real media. Every campaign in
 * this mock-only phase plays the same public HLS reference stream
 * (`features/player/video-source.ts`), so this test taps Play and waits
 * for that real, network-loaded media before asserting on keyboard seeking
 * — otherwise it would only prove that a controlled input's value prop
 * resists change, not the thing YT-0412 asks about.
 */

async function startPlaybackAndWaitForDuration(page: Page): Promise<void> {
  const playButton = page.getByRole("button", { name: /^Play /i });
  await playButton.click();
  await page.waitForFunction(
    () => {
      const video = document.querySelector("video");
      return video !== null && Number.isFinite(video.duration) && video.duration > 0;
    },
    undefined,
    { timeout: 45_000 },
  );
}

test("seek bar responds to ArrowRight/ArrowLeft, Home and End", async ({ page }) => {
  await page.goto(`/watch/${LONG_FORM_CAMPAIGN_ID}`);
  await page.waitForLoadState("networkidle");
  await startPlaybackAndWaitForDuration(page);

  const seekBar = page.getByRole("slider", { name: "Seek" });
  await expect(seekBar).toBeVisible();

  const min = Number(await seekBar.getAttribute("min"));
  const max = Number(await seekBar.getAttribute("max"));
  const step = Number(await seekBar.getAttribute("step"));
  expect(max, "fixture campaign should have a real duration").toBeGreaterThan(min);

  await seekBar.focus();

  await seekBar.press("Home");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", min);

  await seekBar.press("End");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", max);

  await seekBar.press("ArrowLeft");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", max - step);

  await seekBar.press("Home");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", min);

  await seekBar.press("ArrowRight");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", min + step);

  await seekBar.press("ArrowRight");
  await expect(seekBar).toHaveJSProperty("valueAsNumber", min + step * 2);
});

test("seek bar's aria-valuetext tracks keyboard-driven position", async ({ page }) => {
  await page.goto(`/watch/${LONG_FORM_CAMPAIGN_ID}`);
  await page.waitForLoadState("networkidle");
  await startPlaybackAndWaitForDuration(page);

  const seekBar = page.getByRole("slider", { name: "Seek" });
  await seekBar.focus();

  await seekBar.press("Home");
  await expect(seekBar).toHaveAttribute("aria-valuetext", /0:00 of/);

  await seekBar.press("End");
  const endText = await seekBar.getAttribute("aria-valuetext");
  expect(endText, "aria-valuetext should change once the value is at the max").not.toMatch(
    /^0:00 of/,
  );
});
