import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SeekSlider } from "./seek-slider";
import type { Chapter } from "./chapter";

const chapters: Chapter[] = [
  { index: 0, label: "Chapter 1", startSeconds: 0, endSeconds: 180, rewardPoints: 200 },
  { index: 1, label: "Chapter 2", startSeconds: 180, endSeconds: 360, rewardPoints: 200 },
];

describe("SeekSlider", () => {
  it("is a real slider with an accessible name and a human-readable current-time value text", () => {
    render(<SeekSlider currentSeconds={65} durationSeconds={360} chapters={chapters} onSeek={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Seek" });
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("1:05"));
  });

  /**
   * NOT TESTED HERE, DELIBERATELY: ArrowLeft/Right/Up/Down and Home/End
   * seeking. This control is a native `<input type="range">`, so that
   * behaviour belongs to the browser, and jsdom does not implement it —
   * `fireEvent.keyDown` cannot fake it (the same reason a native <button>
   * cannot be tested for Enter/Space activation in jsdom).
   *
   * The previous Radix Slider implemented those keys in JavaScript, which
   * jsdom COULD exercise — so swapping to the native element to stay inside
   * the 170 KB initial-JS gate genuinely traded automated keyboard coverage
   * for bundle size. The behaviour is stronger in a real browser, not
   * weaker, but it is now unverified by this suite and needs a Playwright or
   * manual pass. Asserted below is what jsdom can honestly check: the
   * element exposes the right role, bounds, value and announcement text, and
   * a value change reaches `onSeek`.
   */
  it("exposes slider semantics with the bounds and announcement a screen reader needs", () => {
    render(<SeekSlider currentSeconds={100} durationSeconds={360} chapters={chapters} onSeek={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Seek" });

    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "360");
    expect(slider).toHaveValue("100");
    expect(slider).toHaveAttribute("aria-valuetext", "1:40 of 6:00");
  });

  it("reports the new position to onSeek when the value changes", () => {
    const onSeek = vi.fn();
    render(<SeekSlider currentSeconds={100} durationSeconds={360} chapters={chapters} onSeek={onSeek} />);

    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "240" } });
    expect(onSeek).toHaveBeenCalledWith(240);
  });

});
