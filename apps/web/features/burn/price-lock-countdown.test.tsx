import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceLockCountdown } from "./price-lock-countdown";

function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

const NOW = new Date("2026-09-19T10:00:00.000Z");

describe("PriceLockCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a full-strength progressbar and clock right after the price is shown", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 600_000).toISOString();
    render(<PriceLockCountdown lockExpiresAt={lockExpiresAt} onExpire={vi.fn()} />);

    const bar = screen.getByRole("progressbar", { name: "Sisa waktu kunci harga" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  });

  it("switches to the expired presentation and calls onExpire once the lock runs out", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();
    const onExpire = vi.fn();
    render(<PriceLockCountdown lockExpiresAt={lockExpiresAt} onExpire={onExpire} />);

    advanceSeconds(3);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Harga kedaluwarsa")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
