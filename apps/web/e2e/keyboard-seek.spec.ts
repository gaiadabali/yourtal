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

/**
 * YT-0412 — BLOCKED, NOT FAILING. `test.fixme` is deliberate.
 *
 * These specs are correct and should pass. They cannot yet, because every
 * campaign points at one shared public HLS placeholder whose single ~59 MB
 * segment reliably aborts before the <video> element ever reports a finite
 * `duration` (see features/player/video-source.ts, which documents the
 * placeholder as a known gap). Without a duration the seek bar has no range
 * to seek within, so the keyboard assertions below have nothing to observe.
 *
 * Marked `fixme` rather than left red on purpose: a permanently-failing
 * suite teaches people to ignore failures, and then a real regression hides
 * among the noise. The acceptance criterion stays UNTICKED in
 * docs/tasks/phase-u-ui.md — this is a tracked gap, not a passing test.
 *
 * To unblock: point a campaign at a small multi-segment HLS fixture served
 * locally (YT-0526), then delete the two `test.fixme` markers below. Nothing
 * else here should need to change.
 */
test.fixme("seek bar responds to ArrowRight/ArrowLeft, Home and End", async ({ page }) => {
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

test.fixme("seek bar's aria-valuetext tracks keyboard-driven position", async ({ page }) => {
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
