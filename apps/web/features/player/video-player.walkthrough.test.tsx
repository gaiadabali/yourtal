import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { campaignTermsSchema } from "@yourtal/contracts/campaign/terms";
import { VideoPlayer } from "./video-player";

/**
 * The founder walkthrough's player findings (2026-10-21): V24 and V7 (a
 * question must not restart the video, and a timed-out one is said so), V12
 * (an already-earned video says so and never shows a failure), and 5.9.f
 * (the completion refusal says what is missing). The state machine is driven
 * through the mocked actions, as in `video-player.test.tsx`.
 */
const hls = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("./hls-attacher", async () => {
  const { useEffect } = await import("react");
  return {
    HlsAttacher: () => {
      useEffect(() => {
        hls.mounts += 1;
        return () => {
          hls.unmounts += 1;
        };
      }, []);
      return null;
    },
  };
});

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  report: vi.fn(),
  complete: vi.fn(),
  present: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("./watch-player-actions", () => ({
  startWatchSessionAction: actions.start,
  getWatchSessionAction: actions.get,
  reportWatchProgressAction: actions.report,
  completeWatchSessionAction: actions.complete,
  presentCheckpointAction: actions.present,
  answerCheckpointAction: actions.answer,
}));
vi.mock("./identity-check-actions", () => ({
  requestEmailVerificationAction: vi.fn().mockResolvedValue({ ok: true }),
}));

const playMock = vi.fn().mockResolvedValue(undefined);
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = playMock;
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

const MANIFEST = "/media/hls/1/2/session-1/index.m3u8";

function started(session: {
  nonEarning: boolean;
  nonEarningReason: string | null;
  identityCheck?: { missing: string[] };
}) {
  const { identityCheck, ...rest } = session;
  return {
    ok: true as const,
    data: {
      session: { id: "session-1", questionsAsked: 0, ...rest },
      durationSeconds: 90,
      alreadyEarned: session.nonEarningReason === "already_earned",
      manifestUrl: MANIFEST,
      ...(identityCheck === undefined ? {} : { identityCheck }),
    },
  };
}

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

beforeEach(() => {
  hls.mounts = 0;
  hls.unmounts = 0;
  actions.start
    .mockReset()
    .mockResolvedValue(started({ nonEarning: false, nonEarningReason: null }));
  actions.get.mockReset().mockResolvedValue({
    ok: true,
    data: {
      session: { id: "session-1", nonEarning: false, nonEarningReason: null, questionsAsked: 0 },
      durationSeconds: 90,
      coveredSeconds: 0,
      gaps: [{ fromSecond: 0, toSecond: 90 }],
    },
  });
  actions.report
    .mockReset()
    .mockResolvedValue({ ok: true, data: { accepted: true, coveredSeconds: 40 } });
  actions.complete.mockReset();
  actions.present.mockReset().mockResolvedValue({
    ok: true,
    data: {
      question,
      token: "tok-1",
      expiresAt: "2026-09-19T09:01:30.000Z",
      atSecond: 40,
      answerTimerMs: 30_000,
    },
  });
  actions.answer
    .mockReset()
    .mockResolvedValue({ ok: true, data: { answered: true, wasCorrect: true } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function video(): HTMLVideoElement {
  const element = document.querySelector("video");
  if (!element) throw new Error("expected a <video> element");
  return element;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Fake timers before the session starts (the polling interval is created then), then plays until the question is due. */
async function playUntilQuestion(locale: "en-AU" | "id-ID" = "en-AU") {
  vi.useFakeTimers();
  render(<VideoPlayer campaign={campaign} terms={terms} locale={locale} />);
  fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
  await flush();
  Object.defineProperty(video(), "paused", { value: false, configurable: true });
  Object.defineProperty(video(), "ended", { value: false, configurable: true });
  Object.defineProperty(video(), "currentTime", { value: 45, configurable: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
}

describe("V24: a question must not restart the video", () => {
  it("keeps the HLS player attached for the whole question and after the answer", async () => {
    await playUntilQuestion();
    expect(hls.mounts).toBe(1);
    // Unmounting the attacher destroys the stream; re-attaching starts at 0:00.
    expect(hls.unmounts).toBe(0);

    fireEvent.click(screen.getByRole("radio", { name: "Fact A" }));
    await flush();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hls.mounts).toBe(1);
    expect(hls.unmounts).toBe(0);
  });

  it("keeps the source on a native-HLS browser too, and resumes playing", async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    await playUntilQuestion();
    expect(video().getAttribute("src")).toBe(MANIFEST);
    expect(video().hasAttribute("controls")).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: "Fact A" }));
    await flush();
    expect(video().getAttribute("src")).toBe(MANIFEST);
    expect(video().hasAttribute("controls")).toBe(true);
    expect(playMock).toHaveBeenCalled();
  });
});

describe("V7: a question that runs out of time is said so", () => {
  it("keeps the video and says what it means for the reward and the bonus", async () => {
    await playUntilQuestion();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // Submitted as unanswered, never as a guess.
    expect(actions.answer).toHaveBeenCalledWith("session-1", 0, "tok-1", null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hls.unmounts).toBe(0);
    expect(
      screen.getByText(
        "Time ran out on the question, so it counts as unanswered. You still earn your reward when you finish the video, but not the accuracy bonus.",
      ),
    ).toBeInTheDocument();
  });

  it("says it in Bahasa", async () => {
    await playUntilQuestion("id-ID");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText(/Waktu untuk pertanyaan habis/)).toBeInTheDocument();
  });

  it("says nothing when the viewer answered in time", async () => {
    await playUntilQuestion();
    fireEvent.click(screen.getByRole("radio", { name: "Fact A" }));
    await flush();
    expect(screen.queryByText(/Time ran out/)).not.toBeInTheDocument();
  });
});

describe("V12: a video the viewer has already earned", () => {
  beforeEach(() => {
    actions.start.mockResolvedValue(
      started({ nonEarning: true, nonEarningReason: "already_earned" }),
    );
  });

  it("says so as soon as it plays, without an earn promise", async () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    expect(
      await screen.findByText(
        "You've already earned the points for this video. You can watch it again, but it won't earn more.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Finish the video to earn your points/)).not.toBeInTheDocument();
  });

  it("says so at the end and shows no failure, without asking the server to claim anything", async () => {
    // The player reports no coverage for a view that cannot earn, so the
    // server refuses a claim on it (403 "have not been watched"), and that
    // used to surface as "this video couldn't start".
    actions.complete.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "forbidden", message: "not watched" },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    await screen.findByRole("status");
    fireEvent.ended(video());

    expect(
      await screen.findByText("You have already earned points for this video."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't start/)).not.toBeInTheDocument();
    expect(actions.complete).not.toHaveBeenCalled();
    expect(actions.report).not.toHaveBeenCalled();
  });

  it("says so at the end in Bahasa", async () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="id-ID" />);
    fireEvent.click(screen.getByRole("button", { name: /Putar/ }));
    await screen.findByRole("status");
    fireEvent.ended(video());
    expect(
      await screen.findByText("Kamu sudah mendapatkan poin dari video ini."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("5.9.f: the completion refusal says what is missing", () => {
  async function finishRefused(missing: string[] | undefined) {
    actions.complete.mockResolvedValue({
      ok: true,
      data: {
        completed: true,
        granted: false,
        pendingPoints: 0,
        reason: "identity_check_required",
        ...(missing === undefined ? {} : { missing }),
      },
    });
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    await flush();
    fireEvent.ended(video());
    await waitFor(() => expect(actions.complete).toHaveBeenCalled());
  }

  it("does not offer the verification email to a verified person on a disposable address", async () => {
    await finishRefused(["use_permanent_email"]);
    expect(
      await screen.findByText("This email address can't be used to earn points."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send me the verification email" }),
    ).not.toBeInTheDocument();
  });

  it("offers it when the email is unverified", async () => {
    await finishRefused(["verify_email"]);
    expect(
      await screen.findByText("Verify your email to start earning points."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send me the verification email" }),
    ).toBeInTheDocument();
  });

  it("still offers it when the server did not say what is missing", async () => {
    await finishRefused(undefined);
    expect(
      await screen.findByRole("button", { name: "Send me the verification email" }),
    ).toBeInTheDocument();
  });
});

describe("V12b: a repeat visit that has earlier coverage waits for the viewer's choice", () => {
  beforeEach(() => {
    actions.get.mockResolvedValue({
      ok: true,
      data: {
        session: { id: "session-1", nonEarning: false, nonEarningReason: null, questionsAsked: 0 },
        durationSeconds: 90,
        coveredSeconds: 60,
        gaps: [{ fromSecond: 60, toSecond: 90 }],
      },
    });
  });

  it("shows the Continue watching dialog and plays nothing until it is answered", async () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "You watched up to 1:00 last time.",
    );
    expect(hls.mounts).toBe(0);
    expect(video().currentTime).toBe(0);
    expect(video().hasAttribute("controls")).toBe(false);
  });

  it("applies the resume position again once the stream's metadata arrives", async () => {
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Resume from 1:00/ }));
    await waitFor(() => expect(hls.mounts).toBe(1));
    expect(video().currentTime).toBe(60);

    // A browser may drop a seek made before the source is attached.
    video().currentTime = 0;
    fireEvent.loadedMetadata(video());
    expect(video().currentTime).toBe(60);
  });
});
