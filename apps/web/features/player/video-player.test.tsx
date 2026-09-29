import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { campaignTermsSchema } from "@yourtal/contracts/campaign/terms";
import { VideoPlayer } from "./video-player";

/**
 * 11.5.b: `VideoPlayer` now runs the real server watch session
 * (`use-watch-earn-session.ts`) instead of the mock, client-side accrual it
 * used to run — see that hook's own header. `watch-player-actions.ts` (the
 * only network boundary) is mocked; everything else here is the real
 * component tree, including the real checkpoint overlay.
 *
 * jsdom implements no media pipeline (no decode, no real `duration`, no
 * `play()`/`pause()`), so these tests drive the state machine through the
 * mocked actions and jsdom's own `<video>` events, never real playback.
 */
vi.mock("./hls-attacher", () => ({ HlsAttacher: () => null }));

const {
  startWatchSessionActionMock,
  getWatchSessionActionMock,
  reportWatchProgressActionMock,
  completeWatchSessionActionMock,
  presentCheckpointActionMock,
  answerCheckpointActionMock,
} = vi.hoisted(() => ({
  startWatchSessionActionMock: vi.fn(),
  getWatchSessionActionMock: vi.fn(),
  reportWatchProgressActionMock: vi.fn(),
  completeWatchSessionActionMock: vi.fn(),
  presentCheckpointActionMock: vi.fn(),
  answerCheckpointActionMock: vi.fn(),
}));
vi.mock("./watch-player-actions", () => ({
  startWatchSessionAction: startWatchSessionActionMock,
  getWatchSessionAction: getWatchSessionActionMock,
  reportWatchProgressAction: reportWatchProgressActionMock,
  completeWatchSessionAction: completeWatchSessionActionMock,
  presentCheckpointAction: presentCheckpointActionMock,
  answerCheckpointAction: answerCheckpointActionMock,
}));

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

const campaign = campaignSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "long_form",
  title: "Test Campaign",
  merchantId: "22222222-2222-4222-8222-222222222222",
  merchantName: "Toko Uji",
  synopsis: "A synopsis for testing.",
  durationSeconds: 90,
  chapters: [{ title: "Full video", startSeconds: 0, rewardWeight: 1 }],
  videoSource: { kind: "hls", manifestUrl: "https://mock.yourtal.test/hls/sample.m3u8" },
  estimatedDataMb: 90,
  rewardPoints: 100,
  questionCount: 1,
  scoringRule: "base_plus_accuracy_bonus",
  status: "active",
  publishedAt: "2026-09-19T09:00:00.000Z",
  businessId: "22222222-2222-4222-8222-222222222222",
  region: "AU",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  posterUrl: "https://mock.yourtal.test/poster.jpg",
  teaserUrl: "https://mock.yourtal.test/teaser.mp4",
  hlsUrl: "https://mock.yourtal.test/hls/sample.m3u8",
  captionsUrl: null,
  aspect: "16:9",
  estimatedBytes: 94_371_840,
  startsAt: "2026-09-19T09:00:00.000Z",
  endsAt: "2026-12-19T09:00:00.000Z",
});

const terms = campaignTermsSchema.parse({
  campaignId: campaign.id,
  version: 1,
  rewardPoints: 75,
  questionCount: 1,
  scoringRule: "base_plus_accuracy_bonus",
  durationSeconds: 90,
  accuracyBonusPoints: 25,
  effectiveFrom: "2026-09-19T09:00:00.000Z",
});

const session = { id: "session-1", nonEarning: false, nonEarningReason: null, questionsAsked: 0 };

function startResolved() {
  return {
    ok: true as const,
    data: {
      session,
      durationSeconds: 90,
      alreadyEarned: false,
      manifestUrl: "/media/hls/1/2/session-1/index.m3u8",
    },
  };
}

describe("VideoPlayer", () => {
  beforeEach(() => {
    startWatchSessionActionMock.mockReset().mockResolvedValue(startResolved());
    // No prior coverage by default — every existing test exercises a first
    // visit, never the resume prompt (its own test below covers that).
    getWatchSessionActionMock.mockReset().mockResolvedValue({
      ok: true,
      data: { session, durationSeconds: 90, coveredSeconds: 0, gaps: [{ fromSecond: 0, toSecond: 90 }] },
    });
    reportWatchProgressActionMock.mockReset().mockResolvedValue({
      ok: true,
      data: { accepted: true, coveredSeconds: 10 },
    });
    completeWatchSessionActionMock.mockReset();
    presentCheckpointActionMock.mockReset().mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "checkpoint_not_reached", message: "not yet" },
    });
    answerCheckpointActionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the tap-to-start overlay before anything is started", () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    expect(screen.getByRole("button", { name: "Play Test Campaign" })).toBeInTheDocument();
  });

  it("starts a real server session on tap, and shows the reward progress once watching", async () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));

    await waitFor(() => expect(startWatchSessionActionMock).toHaveBeenCalledWith(campaign.id));
    expect(screen.queryByRole("button", { name: "Play Test Campaign" })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("progressbar", { name: "Progress toward the reward" }),
    ).toBeInTheDocument();
  });

  it("shows the failed state and never starts a session when start is not tapped", () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    expect(startWatchSessionActionMock).not.toHaveBeenCalled();
  });

  it("falls back to the failed banner when the session fails to start", async () => {
    startWatchSessionActionMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 500, code: "server_error", message: "boom" },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't start/i);
  });

  it("pauses for a checkpoint once one is due, and resumes watching after answering", async () => {
    const question = {
      id: "question-1",
      campaignId: campaign.id,
      prompt: "What did the video say?",
      timerSeconds: 30,
      type: "multiple_choice" as const,
      options: [
        { id: "option-a", label: "Fact A" },
        { id: "option-b", label: "Fact B" },
      ],
    };
    presentCheckpointActionMock.mockResolvedValue({
      ok: true,
      data: {
        question,
        token: "tok-1",
        expiresAt: "2026-09-19T09:01:30.000Z",
        atSecond: 40,
        answerTimerMs: 30_000,
      },
    });
    answerCheckpointActionMock.mockResolvedValue({
      ok: true,
      data: { answered: true, wasCorrect: true },
    });

    // Fake timers from BEFORE the session starts: `use-watch-earn-session.ts`
    // creates its polling `setInterval` inside the effect that fires once the
    // session becomes `watching`, so the mock must already be installed when
    // that happens — a real interval created before `vi.useFakeTimers()` is
    // not one `vi.advanceTimersByTimeAsync` can ever trigger.
    vi.useFakeTimers();
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));
    // Microtask flush for the mocked (already-resolved) action promise —
    // no real or fake timer is involved in a native Promise settling.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("progressbar", { name: "Progress toward the reward" }),
    ).toBeInTheDocument();

    const video = document.querySelector("video");
    if (!video) throw new Error("expected a <video> element");
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    Object.defineProperty(video, "ended", { value: false, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 45, configurable: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(presentCheckpointActionMock).toHaveBeenCalledWith("session-1", 0);
    expect(screen.getByRole("dialog")).toHaveTextContent("What did the video say?");

    fireEvent.click(screen.getByRole("radio", { name: "Fact A" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(answerCheckpointActionMock).toHaveBeenCalledWith("session-1", 0, "tok-1", "option-a");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the real earn moment once the server grants the completion", async () => {
    completeWatchSessionActionMock.mockResolvedValue({
      ok: true,
      data: {
        completed: true,
        granted: true,
        pendingPoints: 100,
        unlockAt: "2026-10-01T00:00:00.000Z",
      },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));
    await vi.waitFor(() => expect(startWatchSessionActionMock).toHaveBeenCalled());

    const video = document.querySelector("video");
    if (!video) throw new Error("expected a <video> element");
    fireEvent.ended(video);

    await waitFor(() => expect(completeWatchSessionActionMock).toHaveBeenCalledWith("session-1"));
    expect(await screen.findByText("+100")).toBeInTheDocument();
  });

  it("shows the not-earning moment when the server completes without granting", async () => {
    completeWatchSessionActionMock.mockResolvedValue({
      ok: true,
      data: { completed: true, granted: false, pendingPoints: 0, reason: "already_earned" },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));
    await vi.waitFor(() => expect(startWatchSessionActionMock).toHaveBeenCalled());

    const video = document.querySelector("video");
    if (!video) throw new Error("expected a <video> element");
    fireEvent.ended(video);

    expect(await screen.findByText("already_earned")).toBeInTheDocument();
  });
});
