import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { playerChapters } from "./player-chapters";
import { VideoPlayer } from "./video-player";

/**
 * YT-0551's sabotage proof, at the level the ticket actually asks about:
 * the hook that decides whether the checkpoint hand-off mounts.
 *
 * Per docs/13-engineering-standards.md §4 and docs/13c-lessons.md: "prove a
 * check by breaking what it is meant to catch, then confirm the break
 * actually reached the code." The two attacks named in the ticket —
 * scrubbing to the end, and dispatching a synthetic `ended` — are each
 * their own test below, and each asserts the hand-off does NOT mount.
 * `video-player.test.tsx` covers this hook's other behaviour; this file is
 * `use-watch-session.ts`'s own, since a hook change is what YT-0551 asks
 * for, and testing it through the rendered player is how jsdom can observe
 * it — jsdom's `<video>` has no real playback (see that file's top
 * comment), but it does support the events and properties this fix reads,
 * which is exactly what's under test here.
 */
vi.mock("./hls-attacher", () => ({
  HlsAttacher: () => null,
}));

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

const campaign = campaignSchema.parse({
  id: "33333333-3333-4333-8333-333333333333",
  kind: "long_form",
  title: "Coverage Test Campaign",
  merchantId: "44444444-4444-4444-8444-444444444444",
  merchantName: "Toko Uji",
  synopsis: "A synopsis for testing.",
  durationSeconds: 900,
  chapters: [{ title: "Pembuka", startSeconds: 0, rewardWeight: 1 }],
  videoSource: { kind: "hls", manifestUrl: "https://mock.yourtal.test/hls/sample.m3u8" },
  estimatedDataMb: 90,
  rewardPoints: 1_000,
  questionCount: 1,
  scoringRule: "base_only",
  status: "active",
  publishedAt: "2026-09-19T09:00:00.000Z",
});
const chapters = playerChapters(campaign);
const HAND_OFF_LINK = { name: "Continue to questions" };

function mountAndReadyVideo(realDurationSeconds: number): HTMLVideoElement {
  render(<VideoPlayer campaign={campaign} chapters={chapters} />);
  const video = document.querySelector("video");
  if (!video) {
    throw new Error("expected the player to render a <video> element");
  }
  Object.defineProperty(video, "duration", {
    value: realDurationSeconds,
    configurable: true,
  });
  Object.defineProperty(video, "currentTime", {
    value: 0,
    writable: true,
    configurable: true,
  });
  act(() => {
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  return video;
}

/** A genuine forward playback tick: no `seeking` precedes it. */
function play(video: HTMLVideoElement, toSeconds: number) {
  Object.defineProperty(video, "currentTime", {
    value: toSeconds,
    writable: true,
    configurable: true,
  });
  act(() => {
    video.dispatchEvent(new Event("timeupdate"));
  });
}

/** A seek: `seeking` then `seeked`, exactly as the browser fires them. */
function seek(video: HTMLVideoElement, toSeconds: number) {
  act(() => {
    video.dispatchEvent(new Event("seeking"));
  });
  Object.defineProperty(video, "currentTime", {
    value: toSeconds,
    writable: true,
    configurable: true,
  });
  act(() => {
    video.dispatchEvent(new Event("seeked"));
  });
}

describe("useWatchSession completion gating (YT-0551)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("the attack: a single scrub to the end does not mount the checkpoint hand-off", () => {
    const video = mountAndReadyVideo(20);
    seek(video, 20);
    expect(screen.queryByRole("link", HAND_OFF_LINK)).not.toBeInTheDocument();

    // Chrome declines to fire `ended` on a seek landing at the end — but
    // this must hold even if some engine did, so it is asserted anyway.
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.queryByRole("link", HAND_OFF_LINK)).not.toBeInTheDocument();
  });

  it("the attack: a synthetic `ended` event with zero real playback does not mount the hand-off", () => {
    const video = mountAndReadyVideo(20);
    // No timeupdate, no seek — nothing was ever played. This is exactly
    // `video.dispatchEvent(new Event("ended"))` from a console.
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.queryByRole("link", HAND_OFF_LINK)).not.toBeInTheDocument();
  });

  it("the attack: playing most of it and skipping the rest still does not mount the hand-off", () => {
    const video = mountAndReadyVideo(20);
    play(video, 5);
    seek(video, 19.9);
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.queryByRole("link", HAND_OFF_LINK)).not.toBeInTheDocument();
  });

  it("control: real playback ticks covering the whole timeline DOES mount the hand-off", () => {
    const video = mountAndReadyVideo(20);
    for (let second = 1; second <= 20; second += 1) {
      play(video, second);
    }
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.getByRole("link", HAND_OFF_LINK)).toBeInTheDocument();
  });

  it("control: a rewind-and-replay still earns, since the coverage rule counts a second once however often it is played", () => {
    const video = mountAndReadyVideo(20);
    for (let second = 1; second <= 20; second += 1) {
      play(video, second);
    }
    // Rewatch the middle, then confirm the hand-off is (still) present —
    // rewatching must never revoke a genuinely earned completion.
    seek(video, 5);
    play(video, 10);
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.getByRole("link", HAND_OFF_LINK)).toBeInTheDocument();
  });
});

describe("useWatchSession seek coalescing (YT-0550)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("queues a seek requested while one is already in flight, rather than issuing a second overlapping one", () => {
    const video = mountAndReadyVideo(900);
    const slider = screen.getByRole("slider", { name: "Seek" });

    fireEvent.change(slider, { target: { value: "5" } });
    expect(video.currentTime).toBeCloseTo(5, 5); // toRealSeconds(5, 900, 900) === 5

    // Simulate the video reporting a seek still in flight against the
    // network origin (the exact condition YT-0550's fix checks for).
    Object.defineProperty(video, "seeking", { value: true, configurable: true });

    fireEvent.change(slider, { target: { value: "700" } });
    // Coalesced, not applied yet — the position must not have moved again
    // while a seek is reported in flight.
    expect(video.currentTime).toBeCloseTo(5, 5);

    // The in-flight seek settles. `seeked` should apply the LATEST queued
    // target exactly once.
    Object.defineProperty(video, "seeking", { value: false, configurable: true });
    act(() => {
      video.dispatchEvent(new Event("seeked"));
    });
    expect(video.currentTime).toBeCloseTo(700, 5);
  });

  it("applies a seek immediately when nothing is in flight", () => {
    const video = mountAndReadyVideo(900);
    const slider = screen.getByRole("slider", { name: "Seek" });

    fireEvent.change(slider, { target: { value: "300" } });
    expect(video.currentTime).toBeCloseTo(300, 5);
  });

  /**
   * YT-0586 — the window YT-0550's coalescing left open.
   *
   * `handleSeekTo` reads `video.seeking`, and only then writes the queued
   * target. Those two steps are not atomic from the media element's point
   * of view: the browser can settle the in-flight seek and dispatch
   * `seeked` between them. When it does, `flushQueuedSeek` has already run
   * against an empty queue, no further `seeked` is coming, and the target
   * written a moment later is never applied.
   *
   * The `seeking` getter below returns `true` once and `false` afterwards,
   * which is exactly that interleaving expressed in a single-threaded test:
   * the guard sees a seek in flight, and by the time the target is
   * published it has already settled.
   *
   * Without the re-check in `handleSeekTo` this test fails with the
   * playhead still at 5 — the press silently dropped, the symptom
   * `keyboard-seek.spec.ts` records for `Home`.
   */
  it("does not drop a seek that settles between the in-flight check and the queue write", () => {
    const video = mountAndReadyVideo(900);
    const slider = screen.getByRole("slider", { name: "Seek" });

    fireEvent.change(slider, { target: { value: "5" } });
    expect(video.currentTime).toBeCloseTo(5, 5);

    let reads = 0;
    Object.defineProperty(video, "seeking", {
      configurable: true,
      get: () => {
        reads += 1;
        return reads === 1;
      },
    });

    // 700, not 0, even though `Home` is where this was found. The slider is
    // controlled by `virtualCurrentTime`, which only advances on `timeupdate`
    // or `seeked` — neither of which jsdom fires for a `currentTime`
    // assignment. So its displayed value is still "0" here, and changing it
    // to "0" dispatches no change event at all. The drop being tested is
    // about a target being lost, not about which target it was.
    fireEvent.change(slider, { target: { value: "700" } });

    expect(reads, "the guard must re-read `seeking` after publishing the target").toBeGreaterThan(
      1,
    );
    expect(video.currentTime, "the seek must not be silently dropped").toBeCloseTo(700, 5);
  });

  /**
   * YT-0586, second window — the one the e2e data points at.
   *
   * There are TWO seek paths and only one is coalesced. `handleSeekTo`
   * queues behind an in-flight seek; `applyPendingSeek`, wired to
   * `loadedmetadata`, assigns `video.currentTime` directly — no `seeking`
   * check, no queue, no participation in the coalescing at all. A seek
   * requested before the duration is known parks in `pendingSeekRef` and
   * is then applied on that uncoalesced path.
   *
   * That matches what `yourtal-5f` measured: run alone the `Home` case
   * fails ~2 of 3, and it only passes when earlier tests have warmed the
   * media. Warm media means the duration is already known, so the pending
   * path never fires and only the coalesced one runs. Cold media takes the
   * uncoalesced path — which is why neither existing fix clears it. Both
   * of them guard the window that is not the problem.
   */
  it("does not issue an uncoalesced seek when metadata arrives mid-seek", () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    const video = document.querySelector("video");
    if (!video) throw new Error("expected the player to render a <video> element");

    // Duration unknown: a seek now parks in `pendingSeekRef`.
    Object.defineProperty(video, "duration", { value: Number.NaN, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });

    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.change(slider, { target: { value: "300" } });
    expect(video.currentTime, "a seek with no duration must not be applied yet").toBe(0);

    // Metadata lands while the element reports a seek already in flight.
    Object.defineProperty(video, "duration", { value: 900, configurable: true });
    Object.defineProperty(video, "seeking", { value: true, configurable: true });
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(
      video.currentTime,
      "the pending seek must not overtake an in-flight one — that is the overlapping seek YT-0550 removed, on the path it never covered",
    ).toBe(0);

    // It is not lost either: once the in-flight seek settles it lands.
    Object.defineProperty(video, "seeking", { value: false, configurable: true });
    act(() => {
      video.dispatchEvent(new Event("seeked"));
    });
    expect(video.currentTime, "the pending target must still arrive").toBeCloseTo(300, 5);
  });

  /**
   * The partner to the test above: re-checking must not turn one seek into
   * two. If the element is still genuinely seeking, the target stays queued
   * and waits for `seeked` — issuing it immediately would reintroduce the
   * overlapping seeks YT-0550 removed.
   */
  it("still waits when the seek is genuinely still in flight", () => {
    const video = mountAndReadyVideo(900);
    const slider = screen.getByRole("slider", { name: "Seek" });

    fireEvent.change(slider, { target: { value: "5" } });
    Object.defineProperty(video, "seeking", { value: true, configurable: true });

    fireEvent.change(slider, { target: { value: "700" } });
    expect(video.currentTime, "a still-in-flight seek must not be overtaken").toBeCloseTo(5, 5);

    Object.defineProperty(video, "seeking", { value: false, configurable: true });
    act(() => {
      video.dispatchEvent(new Event("seeked"));
    });
    expect(video.currentTime).toBeCloseTo(700, 5);
  });
});
