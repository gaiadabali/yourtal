import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignVideoUpload } from "./campaign-draft";
import { CampaignEditorUpload } from "./campaign-editor-upload";

function StatefulUpload() {
  const [video, setVideo] = useState<CampaignVideoUpload>({
    fileName: null,
    status: "idle",
    progressPercent: 0,
  });
  return <CampaignEditorUpload video={video} onChange={setVideo} />;
}

describe("CampaignEditorUpload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the idle state with no file chosen", () => {
    render(<StatefulUpload />);
    expect(screen.getByText("No video uploaded yet")).toBeInTheDocument();
  });

  it("simulates uploading -> processing -> ready after a file is chosen", () => {
    render(<StatefulUpload />);

    const input = screen.getByLabelText("Video file");
    const file = new File(["fake video bytes"], "launch.mp4", { type: "video/mp4" });
    act(() => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(screen.getByText(/Uploading/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200 * 13); // 13 ticks of 8% each reaches 100%, just before the processing->ready setTimeout fires
    });
    expect(screen.getByText("Processing (encoding, moderation scan)…")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});
