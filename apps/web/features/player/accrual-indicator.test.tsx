import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccrualIndicator } from "./accrual-indicator";

describe("AccrualIndicator", () => {
  it("shows accrued vs. total reward and a progress indicator", () => {
    render(<AccrualIndicator accruedPoints={200} totalPoints={2_000} isPlaying={false} isBackgrounded={false} />);
    expect(screen.getByRole("progressbar", { name: "Reward earned so far" })).toBeInTheDocument();
    expect(screen.getAllByText(/200 poin/).length).toBeGreaterThan(0);
  });

  it("announces an honest 'paused' state only while playing AND the tab is backgrounded", () => {
    const { rerender } = render(
      <AccrualIndicator accruedPoints={200} totalPoints={2_000} isPlaying={true} isBackgrounded={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Earned/);

    rerender(<AccrualIndicator accruedPoints={200} totalPoints={2_000} isPlaying={true} isBackgrounded={true} />);
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);

    // Backgrounded while not playing (e.g. the user paused it themselves) is
    // not "accrual paused by backgrounding" — avoid a misleading message.
    rerender(<AccrualIndicator accruedPoints={200} totalPoints={2_000} isPlaying={false} isBackgrounded={true} />);
    expect(screen.getByRole("status")).not.toHaveTextContent(/paused/i);
  });

  it("never claims the reward is finalized — copy stays provisional/pending", () => {
    render(<AccrualIndicator accruedPoints={200} totalPoints={2_000} isPlaying={true} isBackgrounded={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/pending/i);
  });
});
