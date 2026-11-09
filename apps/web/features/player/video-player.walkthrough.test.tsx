import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const hls = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  onFatalError: undefined as ((message: string) => void) | undefined,
}));
vi.mock("./hls-attacher", async () => {
  const { useEffect } = await import("react");
  return {
    HlsAttacher: ({ onFatalError }: { onFatalError?: (message: string) => void }) => {
      hls.onFatalError = onFatalError;
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
  window.HTMLMediaElement.prototype.load = vi.fn();
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
    playMock.mockClear();
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "You watched up to 1:00 last time.",
    );
    // 5.13.u: the source loads behind the dialog, so the frame shows rather
    // than a dead player, but nothing plays.
    expect(hls.mounts).toBe(1);
    expect(video().autoplay).toBe(false);
    expect(playMock).not.toHaveBeenCalled();
    expect(video().currentTime).toBe(0);
    expect(video().hasAttribute("controls")).toBe(false);
  });

  it("plays once a choice is made", async () => {
    playMock.mockClear();
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Start over/ }));
    await waitFor(() => expect(playMock).toHaveBeenCalled());
    expect(hls.mounts).toBe(1);
  });

  it("5.13.u: Start over asks the earlier attempt's question only where that attempt stopped", async () => {
    vi.useFakeTimers();
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    await flush();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
    await flush();
    Object.defineProperty(video(), "paused", { value: false, configurable: true });
    Object.defineProperty(video(), "ended", { value: false, configurable: true });
    const at = (seconds: number) =>
      Object.defineProperty(video(), "currentTime", { value: seconds, configurable: true });

    at(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(actions.present).not.toHaveBeenCalled();

    at(60);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(actions.present).toHaveBeenCalledWith("session-1", 0);
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

  describe("5.13.y: Start over and Resume once the stream is loaded behind the prompt", () => {
    let position = 0;
    let seeks: number[] = [];

    /** A loaded stream at 0s whose seeks are recorded and land only when told. */
    async function atPrompt() {
      vi.useFakeTimers();
      playMock.mockClear();
      position = 0;
      seeks = [];
      render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
      Object.defineProperty(video(), "readyState", { value: 4, configurable: true });
      Object.defineProperty(video(), "currentTime", {
        configurable: true,
        get: () => position,
        set: (value: number) => {
          seeks.push(value);
          position = value;
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
      await flush();
      await flush();
    }

    it("Start over plays at once and does not seek to where the playhead already is", async () => {
      await atPrompt();
      fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
      await flush();
      expect(seeks).toEqual([]);
      expect(playMock).toHaveBeenCalledTimes(1);
    });

    it("Resume plays only once its seek has landed", async () => {
      await atPrompt();
      fireEvent.click(screen.getByRole("button", { name: /Resume from 1:00/ }));
      await flush();
      expect(seeks).toEqual([60]);
      expect(playMock).not.toHaveBeenCalled();
      fireEvent.seeked(video());
      expect(playMock).toHaveBeenCalledTimes(1);
    });

    it("kicks a Start over that sits still once: seeks back and plays again", async () => {
      await atPrompt();
      fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
      await flush();
      // WebKit, intermittently: not paused, yet stuck at 0.1s on a black frame.
      position = 0.1;
      Object.defineProperty(video(), "paused", { value: false, configurable: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(seeks).toEqual([0]);
      expect(playMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(playMock).toHaveBeenCalledTimes(2);
    });

    it("leaves a playhead that moved, or that the viewer paused, alone", async () => {
      await atPrompt();
      fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
      await flush();
      fireEvent.pause(video());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(playMock).toHaveBeenCalledTimes(1);

      cleanup();
      await atPrompt();
      fireEvent.click(screen.getByRole("button", { name: /Start over/ }));
      await flush();
      position = 2.9;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(seeks).toEqual([]);
    });
  });
});

describe("5.13.af: progress is reported from what the browser played", () => {
  const httpError = (status: number) => ({
    ok: false as const,
    error: { kind: "http" as const, status, code: "error", message: "refused" },
  });
  const accepted = { ok: true as const, data: { accepted: true, coveredSeconds: 40 } };
  const notReached = httpError(409);

  /** Every reported [from, to], in order. */
  const spans = () => actions.report.mock.calls.map((call: unknown[]) => call.slice(1, 3));
  /** True when no reported span claims any second inside (from, to). */
  const nothingClaimedIn = (from: number, to: number) =>
    spans().every((span) => Number(span[1]) <= from || Number(span[0]) >= to);

  /** What the browser has played, as `video.played` reports it. */
  function played(...ranges: [number, number][]) {
    Object.defineProperty(video(), "played", {
      configurable: true,
      value: {
        length: ranges.length,
        start: (i: number) => ranges[i]?.[0] ?? 0,
        end: (i: number) => ranges[i]?.[1] ?? 0,
      },
    });
  }

  async function tick(...ranges: [number, number][]) {
    played(...ranges);
    const last = ranges.at(-1);
    Object.defineProperty(video(), "currentTime", { value: last?.[1] ?? 0, configurable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
  }

  function setPaused(paused: boolean) {
    Object.defineProperty(video(), "paused", { value: paused, configurable: true });
  }

  async function startPlaying() {
    vi.useFakeTimers();
    render(<VideoPlayer campaign={campaign} terms={terms} locale="en-AU" />);
    fireEvent.click(screen.getByRole("button", { name: /Test Campaign/ }));
    await flush();
    setPaused(false);
    Object.defineProperty(video(), "ended", { value: false, configurable: true });
  }

  it("starts the next span after a refused one, and the checkpoint is still asked at its position", async () => {
    // A fake server: refuses the first span, credits every later one, and
    // has a question due once 40s are covered.
    let covered = 0;
    actions.report.mockImplementation((_id: string, _from: number, to: number) => {
      if (actions.report.mock.calls.length === 1) return Promise.resolve(httpError(400));
      covered = Math.max(covered, to);
      return Promise.resolve({ ok: true, data: { accepted: true, coveredSeconds: covered } });
    });
    const presentQuestion = actions.present.getMockImplementation();
    actions.present.mockImplementation((): Promise<unknown> =>
      covered >= 40 ? (presentQuestion?.() as Promise<unknown>) : Promise.resolve(notReached),
    );
    await startPlaying();

    for (const at of [4, 8, 12, 16, 20, 24, 28, 32, 36]) await tick([0, at]);
    expect(spans()).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 16],
      [16, 20],
      [20, 24],
      [24, 28],
      [28, 32],
      [32, 36],
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await tick([0, 40]);
    expect(screen.getByRole("dialog")).toHaveTextContent("What did the video say?");
  });

  it.each([500, 503, 401, 408, 429])("retries the same span after a %i", async (status) => {
    actions.present.mockResolvedValue(notReached);
    actions.report.mockResolvedValueOnce(httpError(status)).mockResolvedValue(accepted);
    await startPlaying();
    await tick([0, 4]);
    await tick([0, 8]);
    expect(spans()).toEqual([
      [0, 4],
      [0, 8],
    ]);
  });

  it("retries after a network failure, but never re-sends a 403 refusal", async () => {
    actions.present.mockResolvedValue(notReached);
    actions.report
      .mockResolvedValueOnce({ ok: false, error: { kind: "network", message: "offline" } })
      .mockResolvedValueOnce(httpError(403))
      .mockResolvedValue(accepted);
    await startPlaying();
    await tick([0, 4]);
    await tick([0, 8]);
    await tick([0, 12]);
    expect(spans()).toEqual([
      [0, 4],
      [0, 8],
      [8, 12],
    ]);
  });

  it("a seek reports what was played before it, and the finish never claims what it skipped", async () => {
    actions.present.mockResolvedValue(notReached);
    actions.complete.mockResolvedValue({
      ok: true,
      data: { completed: true, granted: true, pendingPoints: 100, unlockAt: null },
    });
    await startPlaying();
    await tick([0, 4]);
    // Played on to 6.5, then seeked to 80 and played to the end.
    played([0, 6.5], [80, 89.6]);
    fireEvent.ended(video());
    await flush();
    await flush();
    expect(spans()).toEqual([
      [0, 4],
      [4, 6.5],
      [80, 90],
    ]);
    expect(nothingClaimedIn(6.5, 80)).toBe(true);
  });

  it("a rewind then a skip forward claims only what was played", async () => {
    actions.present.mockResolvedValue(notReached);
    actions.report.mockResolvedValue(accepted);
    await startPlaying();
    await tick([0, 12]);
    // Rewound to 2 and replayed to 6: nothing new.
    await tick([0, 12]);
    // Then skipped to 60.
    await tick([0, 12], [60, 64]);
    expect(spans()).toEqual([
      [0, 12],
      [60, 64],
    ]);
  });

  it("a seek while a report is still in flight neither re-sends it nor claims the skip", async () => {
    actions.present.mockResolvedValue(notReached);
    let answer: (value: unknown) => void = () => undefined;
    actions.report
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      )
      .mockResolvedValue(accepted);
    await startPlaying();
    await tick([0, 4]);
    await tick([0, 5], [60, 64]);
    answer(accepted);
    await flush();
    await tick([0, 5], [60, 68]);
    expect(spans()).toEqual([
      [0, 4],
      [4, 5],
      [60, 64],
      [64, 68],
    ]);
  });

  it("pause, seek, play: the seconds jumped while paused are never claimed", async () => {
    actions.present.mockResolvedValue(notReached);
    actions.report.mockResolvedValue(accepted);
    await startPlaying();
    await tick([0, 10]);
    setPaused(true);
    await tick([0, 10]);
    await tick([0, 10]);
    setPaused(false);
    await tick([0, 10], [50, 52]);
    expect(spans()).toEqual([
      [0, 10],
      [50, 52],
    ]);
    expect(nothingClaimedIn(10, 50)).toBe(true);
  });

  describe("5.13.ag", () => {
    /** Like `tick`, with the playhead somewhere other than the end of what was played. */
    async function tickAt(currentTime: number, ...ranges: [number, number][]) {
      played(...ranges);
      Object.defineProperty(video(), "currentTime", { value: currentTime, configurable: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
    }
    function seekTo(seconds: number) {
      Object.defineProperty(video(), "currentTime", { value: seconds, configurable: true });
      fireEvent.seeking(video());
    }

    it("re-sends a refused span's seconds only once they are really played again", async () => {
      actions.present.mockResolvedValue(notReached);
      actions.report.mockResolvedValueOnce(httpError(403)).mockResolvedValue(accepted);
      await startPlaying();
      await tick([0, 4]);
      await tick([0, 8]);
      await tick([0, 12]);
      // Rewound to 2 and replayed to 6: only 2-4 of the refused span is new.
      seekTo(2);
      await tickAt(6, [0, 12]);
      expect(spans()).toEqual([
        [0, 4],
        [4, 8],
        [8, 12],
        [2, 4],
      ]);
    });

    it("counts only what is replayed after the refusal arrived", async () => {
      actions.present.mockResolvedValue(notReached);
      let refuse: (value: unknown) => void = () => undefined;
      actions.report
        .mockReturnValueOnce(
          new Promise((resolve) => {
            refuse = resolve;
          }),
        )
        .mockResolvedValue(accepted);
      await startPlaying();
      await tick([0, 4]);
      // Rewound to 0 and played to 3 while [0-4] was in flight; then it was refused.
      seekTo(0);
      Object.defineProperty(video(), "currentTime", { value: 3, configurable: true });
      refuse(httpError(403));
      await flush();
      // 3-4 was played again after the refusal; 0-3 only before it.
      await tickAt(7, [0, 7]);
      expect(spans()).toEqual([
        [0, 4],
        [3, 7],
      ]);
    });

    it("a playback error then Retry keeps what was played before it", async () => {
      actions.present.mockResolvedValue(notReached);
      actions.report.mockResolvedValue(accepted);
      await startPlaying();
      await tick([0, 4]);
      // Played to 6.5, then hls.js gave up.
      played([0, 6.5]);
      act(() => hls.onFatalError?.("Playback error: fragLoadError"));
      expect(screen.getByRole("alert")).toHaveTextContent("Playback hit a snag");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await flush();
      expect(hls.mounts).toBe(2);
      // The reload emptied `video.played`, and the stream starts again at 0.
      await tick([0, 2]);
      expect(spans()).toEqual([
        [0, 4],
        [4, 6.5],
      ]);
    });

    it("retries the final send on a server error before claiming", async () => {
      actions.present.mockResolvedValue(notReached);
      actions.report
        .mockResolvedValueOnce(accepted)
        .mockResolvedValueOnce(httpError(503))
        .mockResolvedValue(accepted);
      actions.complete.mockResolvedValue({
        ok: true,
        data: { completed: true, granted: true, pendingPoints: 100, unlockAt: null },
      });
      await startPlaying();
      await tick([0, 4]);
      played([0, 89.6]);
      Object.defineProperty(video(), "ended", { value: true, configurable: true });
      fireEvent.ended(video());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(spans()).toEqual([
        [0, 4],
        [4, 90],
        [4, 90],
      ]);
      expect(actions.complete).toHaveBeenCalledTimes(1);
      expect(actions.report.mock.invocationCallOrder.at(-1)).toBeLessThan(
        actions.complete.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it("gives the final send three tries, then claims anyway", async () => {
      actions.present.mockResolvedValue(notReached);
      actions.report.mockResolvedValueOnce(accepted).mockResolvedValue(httpError(500));
      actions.complete.mockResolvedValue({
        ok: true,
        data: { completed: true, granted: true, pendingPoints: 100, unlockAt: null },
      });
      await startPlaying();
      await tick([0, 4]);
      played([0, 89.6]);
      Object.defineProperty(video(), "ended", { value: true, configurable: true });
      fireEvent.ended(video());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(spans()).toEqual([
        [0, 4],
        [4, 90],
        [4, 90],
        [4, 90],
      ]);
      expect(actions.complete).toHaveBeenCalledTimes(1);
    });
  });
});

describe("5.13.af: a refused finish says why", () => {
  const detail = (gaps: { fromSecond: number; toSecond: number }[], questionsAsked = 0) => ({
    ok: true,
    data: {
      session: { id: "session-1", nonEarning: false, nonEarningReason: null, questionsAsked },
      durationSeconds: 90,
      coveredSeconds: 90 - gaps.reduce((sum, gap) => sum + gap.toSecond - gap.fromSecond, 0),
      gaps,
    },
  });

  async function finishRefused(
    locale: "en-AU" | "id-ID",
    status: number,
    after: ReturnType<typeof detail>,
  ) {
    actions.complete.mockResolvedValue({
      ok: false,
      error: { kind: "http", status, code: "forbidden", message: "refused" },
    });
    // The first read (at start) has nothing covered; the one after the refusal is `after`.
    actions.get.mockResolvedValueOnce(detail([{ fromSecond: 0, toSecond: 90 }]));
    actions.get.mockResolvedValue(after);
    render(<VideoPlayer campaign={campaign} terms={terms} locale={locale} />);
    fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    await flush();
    await flush();
    fireEvent.ended(video());
    return screen.findByRole("alert");
  }

  it.each([
    [[{ fromSecond: 60, toSecond: 90 }], "You haven't watched 30 seconds of this video yet"],
    [[{ fromSecond: 89, toSecond: 90 }], "You haven't watched 1 second of this video yet"],
    [[{ fromSecond: 30, toSecond: 90 }], "You haven't watched 1 minute of this video yet"],
    [
      [
        { fromSecond: 0, toSecond: 40 },
        { fromSecond: 50, toSecond: 90 },
      ],
      "You haven't watched 1 minute 20 seconds of this video yet",
    ],
  ])("counts the gaps %j in English", async (gaps, text) => {
    const alert = await finishRefused("en-AU", 403, detail(gaps));
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent(/couldn't start/);
  });

  it("in Bahasa", async () => {
    const alert = await finishRefused(
      "id-ID",
      403,
      detail([
        { fromSecond: 0, toSecond: 40 },
        { fromSecond: 50, toSecond: 90 },
      ]),
    );
    expect(alert).toHaveTextContent("Kamu belum menonton 1 menit 20 detik dari video ini");
  });

  it("says the questions still need answering when the whole video is covered", async () => {
    expect(await finishRefused("en-AU", 403, detail([]))).toHaveTextContent(
      "not every question has been answered",
    );
  });

  it("says it in Bahasa too", async () => {
    expect(await finishRefused("id-ID", 403, detail([]))).toHaveTextContent(
      "belum semua pertanyaan dijawab",
    );
  });

  it("keeps the connection message for anything but a 403", async () => {
    const alert = await finishRefused("en-AU", 500, detail([{ fromSecond: 60, toSecond: 90 }]));
    expect(alert).toHaveTextContent(/couldn't start/);
  });
});
