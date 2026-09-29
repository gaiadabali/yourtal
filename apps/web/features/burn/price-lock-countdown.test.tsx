import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/burn.json";
import { PriceLockCountdown } from "./price-lock-countdown";

/** `PriceLockCountdown` reads `burn` copy via `useTranslations` (6.1.d) — see `burn-summary.test.tsx` for the same provider pattern. */
function renderPriceLock(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ burn: idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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
    // 15 minutes — the ledger's own real quote lock (`price-lock.ts`'s doc comment).
    const lockExpiresAt = new Date(NOW.getTime() + 900_000).toISOString();
    renderPriceLock(<PriceLockCountdown lockExpiresAt={lockExpiresAt} onExpire={vi.fn()} />);

    const bar = screen.getByRole("progressbar", { name: "Sisa waktu kunci harga" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("timer")).toHaveTextContent("15:00");
  });

  it("switches to the expired presentation and calls onExpire once the lock runs out", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();
    const onExpire = vi.fn();
    renderPriceLock(<PriceLockCountdown lockExpiresAt={lockExpiresAt} onExpire={onExpire} />);

    advanceSeconds(3);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Harga kedaluwarsa")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
