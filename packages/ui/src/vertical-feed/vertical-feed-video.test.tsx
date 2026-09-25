import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VerticalFeedVideo } from "./vertical-feed-video";

function stubReducedMotion(matches: boolean) {
  const mql: Pick<
    MediaQueryList,
    "matches" | "media" | "addEventListener" | "removeEventListener"
  > = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
}

const playMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const pauseMock = vi.fn<() => void>();

describe("VerticalFeedVideo", () => {
  beforeAll(() => {
    window.HTMLMediaElement.prototype.play = playMock;
    window.HTMLMediaElement.prototype.pause = pauseMock;
  });

  beforeEach(() => {
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders only a poster <img>, no <video>, when not mounted", () => {
    const { container } = render(
      <VerticalFeedVideo
        mounted={false}
        active={false}
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("renders a real <video> — muted, playsInline — only once mounted", () => {
    render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    const video = screen.getByLabelText<HTMLVideoElement>("Clip");
    expect(video.tagName).toBe("VIDEO");
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
  });

  it("loops only when the caller passes loop (teaser mode)", () => {
    const { rerender } = render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
        loop
      />,
    );
    expect(screen.getByLabelText("Clip")).toHaveAttribute("loop");

    rerender(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(screen.getByLabelText("Clip")).not.toHaveAttribute("loop");
  });

  it("plays only when active, and pauses once no longer active", () => {
    const { rerender } = render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(playMock).toHaveBeenCalled();

    rerender(
      <VerticalFeedVideo
        mounted
        active={false}
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(pauseMock).toHaveBeenCalled();
  });

  it("does not autoplay under prefers-reduced-motion until the viewer taps once", () => {
    stubReducedMotion(true);
    render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(playMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(playMock).toHaveBeenCalled();
  });

  it("tap toggles pause once playing", () => {
    render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  // jsdom has no media pipeline (see video-player.test.tsx's own comment on
  // the same gap) — it never populates a real HTMLVideoElement's
  // `textTracks` from a child `<track>`, so the actual show/hide-on-mute
  // behaviour (wired in the component's effect, guarded so it no-ops when
  // `textTracks[0]` is absent, as it always is here) needs a real browser to
  // verify. What IS real and checkable here is that the caption track
  // itself renders with the right src/label, so a browser that DOES
  // populate textTracks has something correct to find.
  it("renders a captions track element with the given src, defaulted on", () => {
    render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
        captionsSrc="/clip.vtt"
        captionsLabel="English captions"
        muted
      />,
    );
    const video = screen.getByLabelText("Clip");
    const track = video.querySelector("track");
    expect(track).toHaveAttribute("src", "/clip.vtt");
    expect(track).toHaveAttribute("label", "English captions");
    expect(track).toHaveAttribute("default");
  });

  it("renders no captions track at all when the caller supplies no captionsSrc", () => {
    render(
      <VerticalFeedVideo
        mounted
        active
        src="/clip.mp4"
        poster="/clip.jpg"
        posterAlt=""
        label="Clip"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    expect(screen.getByLabelText("Clip").querySelector("track")).not.toBeInTheDocument();
  });
});
