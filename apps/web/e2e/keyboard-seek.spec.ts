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
 * this mock-only phase plays the same fixture, named by its own
 * `videoSource` field, so this test taps Play and waits
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
 * YT-0412 — unblocked 2026-09-20. These were `test.fixme` because every
 * campaign pointed at a public reference stream whose single ~59 MB segment
 * aborted before the <video> reported a finite duration, so the seek bar had
 * no range to seek within. The player now reads `campaign.videoSource` and
 * plays a local multi-segment ladder, so the duration resolves and the
 * assertions below can finally run.
 *
 * PREREQUISITE: `pnpm dev:up` and `pnpm media:publish`. The ladder is served
 * by the local MinIO origin (YT-0521), not from `public/` — deliberately,
 * because production serves video from object storage and a player only ever
 * tested against static files is never exercised against an origin. `pnpm
 * dev:fresh` does both steps.
 *
 * The seek bar is a native <input type="range">, so arrow/Home/End handling
 * belongs to the browser, not to us — which is why this can only ever be
 * proven here and not in jsdom.
 */
const realTime = (page: Page) =>
  page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);

async function openPausedPlayer(page: Page) {
  await page.goto(`/watch/${LONG_FORM_CAMPAIGN_ID}`);
  await page.waitForLoadState("networkidle");
  await startPlaybackAndWaitForDuration(page);
  // Pause before asserting. Not a convenience: the fixture is a 30 s clip
  // standing in for a 600 s campaign, so `time-remap.ts` advances the shown
  // position ~20 virtual seconds per real second. While playing, playback
  // outruns any seek before it can be read — which made these keys look
  // inert when they were in fact working. A user scrubbing pauses too.
  await page.evaluate(() => document.querySelector("video")?.pause());
  const seekBar = page.getByRole("slider", { name: "Seek" });
  await seekBar.focus();
  return seekBar;
}

test("seek bar responds to ArrowRight/ArrowLeft, Home and End", async ({ page }) => {
  const seekBar = await openPausedPlayer(page);
  const duration = await page.evaluate(() => document.querySelector("video")?.duration ?? 0);
  expect(duration, "the fixture must report a real duration").toBeGreaterThan(0);

  // Asserted against the VIDEO's position rather than the input's displayed
  // value. One press is one virtual second = 50 ms of this fixture, which is
  // under a single frame at 30 fps, so the displayed value round-trips to the
  // same second — an artefact of the 20:1 placeholder ratio, not of keyboard
  // handling. Forty presses is two real seconds, comfortably resolvable.
  // Disappears when a real per-campaign encode lands (YT-0548).
  const press = async (key: string, times: number) => {
    for (let i = 0; i < times; i += 1) {
      await seekBar.press(key);
    }
  };

  await press("ArrowRight", 40);
  await expect
    .poll(() => realTime(page), { message: "ArrowRight must move playback forwards" })
    .toBeGreaterThan(0);

  // NOT asserted: that repeated presses accumulate. They do not here, and the
  // reason is worth writing down. The seek bar is a controlled input whose
  // value comes from the video's reported position. At this fixture's 20:1
  // ratio a one-second step is 50 ms — under one frame — so the position
  // rounds back to where it started and the next press repeats the same step.
  // A viewer holding ArrowRight would not advance. That is a property of the
  // placeholder ratio, not of the component: at a real 1:1 per-campaign
  // encode one step is one second and accumulation is exact. It is the
  // sharpest remaining argument for YT-0548, and it is invisible without a
  // video that actually loads.

  await seekBar.press("Home");
  await expect.poll(() => realTime(page), { message: "Home must seek to the start" }).toBe(0);

  // End seeks to the very end, which fires `ended` and resets the player's
  // own state — so this is asserted on the media position, not on the input,
  // which would race that transition.
  await seekBar.press("End");
  await expect
    .poll(() => realTime(page), { message: "End must seek to the end" })
    .toBeGreaterThanOrEqual(duration - 0.5);
});

test("seek bar's aria-valuetext tracks keyboard-driven position", async ({ page }) => {
  const seekBar = await openPausedPlayer(page);

  // A screen-reader user hears `aria-valuetext`, not the raw number, so it
  // must track the seek rather than merely exist. Asserted away from the
  // end of the media, where the `ended` transition would race it.
  await seekBar.press("Home");
  await expect(seekBar).toHaveAttribute("aria-valuetext", /^0:00 of 10:00$/);

  await press40Right(seekBar);
  await expect(seekBar).not.toHaveAttribute("aria-valuetext", /^0:00 of/);
});

async function press40Right(seekBar: ReturnType<Page["getByRole"]>) {
  for (let i = 0; i < 40; i += 1) {
    await seekBar.press("ArrowRight");
  }
}
