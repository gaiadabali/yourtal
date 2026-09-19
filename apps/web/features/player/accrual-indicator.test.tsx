import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccrualIndicator } from "./accrual-indicator";

describe("AccrualIndicator", () => {
  it("shows a progress indicator and the total reward, never a running accrued figure", () => {
    render(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={false}
        isBackgrounded={false}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "Progress toward the reward" }),
    ).toBeInTheDocument();
    // Decision O-1 (docs/16-decisions.md): all-or-nothing — 200 is never
    // shown as if it were already banked. Only the total (2,000) is a
    // number that ever actually gets paid.
    expect(screen.queryByText(/200 poin/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/2\.000 poin/).length).toBeGreaterThan(0);
  });

  it("announces an honest 'paused' state only while playing AND the tab is backgrounded", () => {
    const { rerender } = render(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={true}
        isBackgrounded={false}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Nothing is paid/i);

    rerender(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={true}
        isBackgrounded={true}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);

    // Backgrounded while not playing (e.g. the user paused it themselves) is
    // not "accrual paused by backgrounding" — avoid a misleading message.
    rerender(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={false}
        isBackgrounded={true}
      />,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(/paused/i);
  });

  it("never implies the reward is banked — copy states the all-or-nothing condition (O-1)", () => {
    render(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={true}
        isBackgrounded={false}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/finish the whole video/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/earned/i);
  });

  it("renders the reward word in English when locale='en-AU' (YT-0405) — the copy here is already English, so a leftover 'poin' would be exactly the drift this ticket exists to catch", () => {
    render(
      <AccrualIndicator
        accruedPoints={200}
        totalPoints={2_000}
        isPlaying={false}
        isBackgrounded={false}
        locale="en-AU"
      />,
    );
    expect(screen.getAllByText(/2,000 points/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bpoin\b/)).not.toBeInTheDocument();
  });
});
