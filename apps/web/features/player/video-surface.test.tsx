import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VideoSurface } from "./video-surface";

/**
 * jsdom implements no media pipeline (no decode, no real HLS parsing) — see
 * `video-player.test.tsx`'s own comment for the same caveat. `HlsAttacher`
 * is mocked entirely so these tests never attempt a real network fetch of
 * the mock manifest or import the real hls.js runtime; the mock exposes the
 * props it was given and a way to simulate a fatal error.
 */
interface HlsAttacherMockProps {
  desiredHeight: number;
  onFatalError?: (message: string) => void;
}

const hlsAttacherProps = vi.fn<(props: HlsAttacherMockProps) => void>();
vi.mock("./hls-attacher", () => ({
  HlsAttacher: (props: HlsAttacherMockProps) => {
    hlsAttacherProps(props);
    return null;
  },
}));

const REQUIRED_COPY = {
  captionsToggleLabel: "Captions",
  errorTitle: "Playback failed",
  errorBody: "Check your connection and try again.",
  retryLabel: "Retry",
};

function stubCanPlayType(returns: string) {
  window.HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue(returns);
}

function stubConnection(connection: { type?: string; saveData?: boolean } | undefined) {
  if (connection) {
    Object.defineProperty(globalThis.navigator, "connection", {
      value: connection,
      configurable: true,
    });
  } else {
    // @ts-expect-error -- test-only removal of a per-test navigator.connection stub.
    delete globalThis.navigator.connection;
  }
}

describe("VideoSurface", () => {
  beforeAll(() => {
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  beforeEach(() => {
    stubCanPlayType(""); // no native HLS by default — exercise the hls.js path
  });

  afterEach(() => {
    stubConnection(undefined);
  });

  it("renders a labelled <video>", () => {
    render(<VideoSurface src="/hls/sample.m3u8" label="Weekend bonus" {...REQUIRED_COPY} />);
    expect(screen.getByLabelText("Weekend bonus").tagName).toBe("VIDEO");
  });

  it("defaults to 360p on a cellular connection", async () => {
    stubConnection({ type: "cellular" });
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" {...REQUIRED_COPY} />);
    await waitFor(() =>
      expect(hlsAttacherProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ desiredHeight: 360 }),
      ),
    );
  });

  it("defaults to 540p off cellular", async () => {
    stubConnection({ type: "wifi" });
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" {...REQUIRED_COPY} />);
    await waitFor(() =>
      expect(hlsAttacherProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ desiredHeight: 540 }),
      ),
    );
  });

  it("defaults to 540p when the Network Information API is unavailable entirely", async () => {
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" {...REQUIRED_COPY} />);
    await waitFor(() =>
      expect(hlsAttacherProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ desiredHeight: 540 }),
      ),
    );
  });

  it("respects a controlled quality prop over the connection default", async () => {
    stubConnection({ type: "cellular" });
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" quality="720p" {...REQUIRED_COPY} />);
    await waitFor(() =>
      expect(hlsAttacherProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ desiredHeight: 720 }),
      ),
    );
  });

  it("never mounts HlsAttacher when the browser can play HLS natively (Safari)", () => {
    stubCanPlayType("probably");
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" {...REQUIRED_COPY} />);
    expect(hlsAttacherProps).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Clip")).toHaveAttribute("src", "/hls/sample.m3u8");
  });

  it("shows a real, alerting error state when HlsAttacher reports a fatal error, and clears it on retry", async () => {
    render(<VideoSurface src="/hls/sample.m3u8" label="Clip" {...REQUIRED_COPY} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(hlsAttacherProps).toHaveBeenCalled());

    const onFatalError = hlsAttacherProps.mock.calls.at(-1)?.[0].onFatalError;
    expect(onFatalError).toBeInstanceOf(Function);
    act(() => {
      onFatalError?.("network error");
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Playback failed");
    expect(alert).toHaveTextContent("Check your connection and try again.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toggles the CC button's aria-pressed state (jsdom has no real textTracks to assert against — see video-player.test.tsx's own caveat)", () => {
    render(
      <VideoSurface
        src="/hls/sample.m3u8"
        label="Clip"
        captionsSrc="/hls/sample.vtt"
        {...REQUIRED_COPY}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Captions" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the captions track element with the given src", () => {
    render(
      <VideoSurface
        src="/hls/sample.m3u8"
        label="Clip"
        captionsSrc="/hls/sample.vtt"
        {...REQUIRED_COPY}
      />,
    );
    const track = screen.getByLabelText("Clip").querySelector("track");
    expect(track).toHaveAttribute("src", "/hls/sample.vtt");
  });
});
