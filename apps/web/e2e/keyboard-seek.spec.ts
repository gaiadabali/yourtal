import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { manifestUrl } from "@yourtal/media/hls-origin";
import { pinRegionCookie } from "./pin-region";

// A named, hand-authored fixture with a fixed literal id in its own
// generator module — not an element of the generated `mockCampaigns` array,
// so its id does not move when a generator's draw order shifts. Its
// `durationSeconds` (600) is also what backs this file's "10:00" aria-
// valuetext assertion below.
const LONG_FORM_CAMPAIGN_ID = zeroRewardCampaignFixture.id;

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

/**
 * A guard that stays untested is not a guard — it is decoration. Every test
 * below depends on the local HLS origin (YT-0521, `pnpm dev:up && pnpm
 * media:publish`, or `pnpm dev:fresh`) actually being up, and without this
 * check a dead origin would fail the WAY THE OLD PLACEHOLDER STREAM DID:
 * `startPlaybackAndWaitForDuration` timing out after tens of seconds with a
 * generic "waitForFunction timed out" error that gives no reason. That is
 * exactly the "guarantees green by never running" failure shape turned
 * inside out — a false RED that reads like a player bug instead of an
 * infrastructure gap — and it is just as dishonest as a false green.
 *
 * This fetches the manifest directly, from Node, before any browser is
 * involved, and fails immediately naming the origin and the fix. Proved to
 * actually fire: run this file with the origin down (stop `pnpm dev:up`'s
 * MinIO container, or point `S3_ENDPOINT` at a closed port) and confirm
 * every test fails here, not fifty seconds later inside the page.
 */
// `get-region.ts`'s cookie-less default is now "AU". Nothing this
// file asserts on (mm:ss text, aria-valuetext, raw video positions) is
// itself locale-formatted, but the `/watch/[campaignId]` route this suite
// exercises now reads the region cookie for the player's point copy
// (`video-player.tsx`'s `locale` prop, task 0.5.c) — pinned so this suite
// stays deterministic regardless of the default region.
test.beforeEach(async ({ context, baseURL }) => {
  await pinRegionCookie(context, "ID", baseURL!);
});

test.beforeAll(async () => {
  const url = manifestUrl();
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(
      `Media origin unreachable at ${url}. This suite cannot prove anything about ` +
        `keyboard seeking without it. Run \`pnpm dev:up && pnpm media:publish\` ` +
        `(or \`pnpm dev:fresh\`) and retry. Underlying error: ${String(cause)}`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Media origin at ${url} responded ${String(response.status)} ${response.statusText}, ` +
        `not 200. Run \`pnpm dev:up && pnpm media:publish\` (or \`pnpm dev:fresh\`) and retry.`,
    );
  }
});

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

/**
 * Waits until the media position stops moving.
 *
 * Needed because the fixture is served by the local MinIO origin (YT-0521),
 * not from `public/`. A seek against an origin has to fetch the segment for
 * the new position, so it lands measurably later than one against a
 * same-process static file — and a key pressed before the previous seek
 * settles is applied to a position that is about to change underneath it.
 *
 * That is not a flaw in the origin; it is what every real deployment looks
 * like, because production serves video from object storage. The old
 * same-origin fixture let this suite assume a latency it will never have
 * again, so the assumption is removed rather than the latency hidden.
 */
async function settle(page: Page): Promise<void> {
  let previous = await realTime(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await realTime(page);
    if (current === previous) return;
    previous = current;
  }
}

async function openPausedPlayer(page: Page) {
  await page.goto(`/watch/${LONG_FORM_CAMPAIGN_ID}`);
  await page.waitForLoadState("networkidle");
  await startPlaybackAndWaitForDuration(page);
  // Pause before asserting. Not a convenience: while playing, playback
  // outruns any seek before it can be read — which made these keys look
  // inert when they were in fact working. A user scrubbing pauses too.
  await page.evaluate(() => document.querySelector("video")?.pause());
  const seekBar = page.getByRole("slider", { name: "Seek" });
  await seekBar.focus();
  return seekBar;
}

test("seek bar responds to ArrowRight, moving playback forwards", async ({ page }) => {
  const seekBar = await openPausedPlayer(page);
  const duration = await page.evaluate(() => document.querySelector("video")?.duration ?? 0);
  expect(duration, "the fixture must report a real duration").toBeGreaterThan(0);

  // Asserted against the VIDEO's position rather than the input's displayed
  // value. One press is one virtual second = 50 ms of this fixture, which is
  // under a single frame at 30 fps, so the displayed value round-trips to the
  // same second — an artefact of the 20:1 placeholder ratio, not of keyboard
  // handling. Forty presses is two real seconds, comfortably resolvable.
  // Disappears when a real per-campaign encode lands (YT-0548).
  for (let i = 0; i < 40; i += 1) {
    await seekBar.press("ArrowRight");
  }
  await settle(page);
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
});

/**
 * FLAKY — found running this exact suite, not a regression from this pass's
 * edits. Reproduces on both `chromium` and `mobile-320`, roughly every other
 * run, always at the SAME value: `realTime(page)` reads back `0.35` after a
 * `Home` press that should land at (within one frame of) `0`. Not a
 * rounding artefact like the "presses don't accumulate" note above — 0.35 s
 * is 7+ frames at 30 fps, and it is bit-for-bit the same number every time
 * it fails, which points at a specific race (most likely: seeking back to
 * segment 0 after the local MinIO origin has already advanced past it,
 * `settle()`'s 20*100ms poll window landing before the re-fetch resolves)
 * rather than ordinary jitter.
 *
 * Left failing/skipped rather than loosening the tolerance: 0.35s is not
 * "within a frame," and widening the assertion to accept it would hide a
 * real seek-latency bug against the origin instead of reporting it.
 *
 * UNBLOCK: reproduce with `--workers=1` a few times while capturing a HAR/
 * trace (`pnpm exec playwright test e2e/keyboard-seek.spec.ts --trace on`)
 * to see whether the video element actually re-buffers segment 0 before
 * `currentTime` settles, or whether `handleSeekTo`
 * (`features/player/use-watch-session.ts`) is racing a still-in-flight
 * previous seek. That is player code, out of this ticket's scope
 * (apps/web/e2e/** only).
 *
 * 2026-09-20, YT-0550: the second hypothesis above now has a fix in
 * `use-watch-session.ts`/`use-video-event-wiring.ts` — `handleSeekTo`
 * coalesces a new seek target while `video.seeking` is still true instead
 * of issuing a second overlapping one, so the 40 rapid `ArrowRight`
 * presses above collapse into far fewer real seeks against the origin
 * before `Home` is pressed. The coalescing mechanism itself is unit-tested
 * (`features/player/use-watch-session.test.tsx`), but **not verified
 * against this real MinIO origin in that pass** — a `next build` here
 * would have shared `.next` with another session's live `next dev`
 * UPDATE 2026-09-21 (YT-0550), CORRECTED SAME DAY. It was flipped to
 * `test(` on three consecutive green full-suite runs and flipped BACK here,
 * because three greens were luck rather than evidence. Measured over nine
 * further full-suite runs against the real MinIO origin: roughly one run in
 * three fails with `Error: Home must seek to the start`, a real assertion
 * failure and not infrastructure. The defect is intermittent, so any small
 * number of green runs can be produced on demand.
 *
 * Both candidate fixes are in the tree and it still flakes: YT-0550's
 * coalescing queue AND YT-0586's re-check of `video.seeking` after the
 * write. Removing the re-check gave 8/7/8 over three runs; keeping it gave
 * roughly six green in nine. Neither arm is clean, so on this evidence the
 * two tickets cannot be told apart AND neither has closed the defect.
 *
 * (docs/13c, "Two agents, one working tree"). Left `test.fixme` rather than
 * flipped to a real assertion: a green run against the real origin is what
 * proves this, not a unit test of the coalescing logic in isolation. The
 * next session with a free build slot: run this with `pnpm dev:up && pnpm
 * media:publish`, and flip to `test(` once it is genuinely green (not
 * "green once" — this failure was intermittent, so require a few
 * consecutive passes, e.g. `--repeat-each=5`, before trusting it).
 */
test.fixme("seek bar responds to Home, seeking to the start", async ({ page }) => {
  const seekBar = await openPausedPlayer(page);
  for (let i = 0; i < 40; i += 1) {
    await seekBar.press("ArrowRight");
  }
  await settle(page);

  // Within one frame (33 ms at 30 fps), not exactly zero. Demanding exact
  // zero asserts on rounding: the displayed value is already 0 at
  // sub-frame positions, and a controlled input fires no change event
  // when its value does not change, so Home becomes a no-op the user
  // never notices.
  await seekBar.press("Home");
  await settle(page);
  await expect
    .poll(() => realTime(page), { message: "Home must seek to the start" })
    .toBeLessThanOrEqual(0.05);
});

test("seek bar responds to End, seeking to the end of the media", async ({ page }) => {
  const seekBar = await openPausedPlayer(page);

  // End is asserted by reading the media position, not by waiting for the
  // completion hand-off.
  //
  // It previously asserted the hand-off, on the reasoning that seeking to
  // the end fires `ended` and the player then swaps the video for the
  // "Continue to questions" link. **Chrome does not do that.** Measured
  // 2026-09-20 against the origin fixture: End puts `currentTime` at exactly
  // `duration` (30 of 30) and leaves `ended` false, because `ended` is set
  // when playback *reaches* the end, not when a seek *lands* there. The
  // hand-off never mounts and the assertion times out.
  //
  // Asserting the position is also the better test of what YT-0412 asks:
  // that the End key seeks to the end. The hand-off was a side effect two
  // browser behaviours away from the key press.
  //
  // ⚠️ AND THE OLD ASSERTION ENCODED SOMETHING THAT SHOULD NOT BE TRUE.
  // "Seeking to the end completes the campaign" means scrubbing counts as
  // watching, which is precisely what `docs/08` and `docs/22` exist to
  // prevent — the reward is for attention, and a drag of the seek bar is
  // not attention. Chrome's behaviour happens to be the safe one here.
  // Whether completion should ever be reachable by seeking is a product
  // decision that belongs in the open, not something a player test should
  // settle by side effect. Raised rather than quietly fixed.
  await seekBar.press("End");
  await settle(page);
  await expect
    .poll(
      async () => {
        const video = await page.evaluate(() => {
          const element = document.querySelector("video");
          return element ? { at: element.currentTime, of: element.duration } : null;
        });
        return video === null ? -1 : video.of - video.at;
      },
      { message: "End must seek to the end of the media" },
    )
    .toBeLessThanOrEqual(0.05);
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

  // Not just the accessible text — the native input's own `value` (the
  // controlled prop `seek-slider.tsx` sets from `session.virtualCurrentTime`)
  // must itself have moved. This is the thing the earlier UNTESTABLE pass
  // could never observe: previously the whole app rendered from a video that
  // never reported a duration, so `value` never left its initial 0 regardless
  // of what a key press did. Asserting only the ARIA text would not catch a
  // regression where the visible slider thumb froze but its label kept
  // updating some other way.
  const displayedValue = Number(await seekBar.inputValue());
  expect(
    displayedValue,
    "the seek bar's own displayed value must reflect the keyboard seek, not just its aria-valuetext",
  ).toBeGreaterThan(0);
});

async function press40Right(seekBar: ReturnType<Page["getByRole"]>) {
  for (let i = 0; i < 40; i += 1) {
    await seekBar.press("ArrowRight");
  }
}
