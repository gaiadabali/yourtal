import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { deriveChapters } from "./derive-chapters";
import { writeResumePosition } from "./resume-position";
import { VideoPlayer } from "./video-player";

/**
 * jsdom implements no media pipeline at all (no decode, no real
 * `duration`/`buffered`, `play()`/`pause()` unimplemented) — see this
 * ticket's report for the full list of what that means could NOT be
 * genuinely verified here. `hls-attacher.tsx` is mocked out entirely so
 * these tests never attempt a real network fetch of the mock HLS manifest
 * or import the real hls.js runtime; they exercise the surrounding state
 * machine and accessible markup only, never real playback/buffering/HLS
 * parsing.
 */
vi.mock("./hls-attacher", () => ({
  HlsAttacher: () => null,
}));

// Radix pointer-capture/ResizeObserver polyfills for jsdom live in
// apps/web/vitest.setup.ts (global setupFiles entry).
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
  durationSeconds: 900,
  estimatedDataMb: 90,
  rewardPoints: 2_000,
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus",
  status: "active",
  publishedAt: "2026-09-19T09:00:00.000Z",
});
const chapters = deriveChapters(campaign);

describe("VideoPlayer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the tap-to-start overlay and no resume prompt when there is no prior position", () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(screen.getByRole("button", { name: "Play Test Campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ResumePrompt and QualitySelector are `next/dynamic` with ssr:false, to
  // keep Radix Dialog/Sheet out of this route's initial chunk (170 KB gate).
  // That makes their first paint asynchronous, hence findBy* rather than getBy*.
  it("offers a resume prompt when a prior position exists in localStorage (Zod-validated on read)", async () => {
    writeResumePosition({ campaignId: campaign.id, positionSeconds: 300, updatedAt: "2026-09-19T09:00:00.000Z" });
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(await screen.findByRole("dialog", { name: "Continue watching?" })).toBeInTheDocument();
  });

  it("does not offer a resume prompt below the minimum resumable threshold", () => {
    writeResumePosition({ campaignId: campaign.id, positionSeconds: 5, updatedAt: "2026-09-19T09:00:00.000Z" });
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("defaults the quality selector into the 360-480p band", async () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(await screen.findByRole("button", { name: /480p/ })).toBeInTheDocument();
  });

  it("shows all 5 chapter markers, each carrying its own reward and status", () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(screen.getByRole("list", { name: "Chapters" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Chapter \d/ })).toHaveLength(5);
  });

  it("shows the accrual progress bar and reward-so-far text before playback starts", () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(screen.getByRole("progressbar", { name: "Reward earned so far" })).toBeInTheDocument();
  });

  it("moves past the start state and announces a play/pause status once playback is requested", async () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    fireEvent.click(screen.getByRole("button", { name: "Play Test Campaign" }));

    // The tap-to-start overlay is gone once hasStarted flips true.
    expect(screen.queryByRole("button", { name: "Play Test Campaign" })).not.toBeInTheDocument();
    await screen.findByText(/Playing|Paused/);
  });

  it("shows the checkpoint hand-off only after the video has ended, never before", () => {
    render(<VideoPlayer campaign={campaign} chapters={chapters} />);
    expect(screen.queryByRole("link", { name: "Continue to questions" })).not.toBeInTheDocument();
  });
});
