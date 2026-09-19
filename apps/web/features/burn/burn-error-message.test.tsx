import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BurnErrorMessage } from "./burn-error-message";
import type { BurnError } from "./burn-errors";

describe("BurnErrorMessage", () => {
  it("states the exact shortfall for insufficient_points", () => {
    render(<BurnErrorMessage error={{ type: "insufficient_points", short: 1_500 }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Poin Anda belum cukup");
    expect(screen.getByRole("alert")).toHaveTextContent("1.500 poin");
  });

  it("explains the holdback in plain language: no transaction jargon, states when it unlocks", () => {
    render(<BurnErrorMessage error={{ type: "holdback_blocks", unlocksAt: "2026-09-22T10:00:00.000Z" }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Sebagian poin Anda masih ditahan sementara");
    expect(alert).toHaveTextContent("mencegah kecurangan");
    // No jargon: none of these words should leak into user-facing copy.
    const forbiddenJargon = ["holdback", "settlement", "authorize", "capture", "ledger"];
    for (const term of forbiddenJargon) {
      expect(alert.textContent?.toLowerCase()).not.toContain(term);
    }
  });

  it("explains that an expired price lock cannot be honoured and points to re-quoting", () => {
    render(<BurnErrorMessage error={{ type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Harga ini sudah tidak berlaku");
    expect(screen.getByRole("alert")).toHaveTextContent("Muat ulang");
  });

  it("tells the user an unavailable listing is out of stock", () => {
    render(<BurnErrorMessage error={{ type: "listing_unavailable", status: "sold_out" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("sudah tidak tersedia");
  });

  it("reassures that points were not deducted after a redemption failure", () => {
    render(<BurnErrorMessage error={{ type: "redemption_failed" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Penukaran gagal");
    expect(screen.getByRole("alert")).toHaveTextContent("belum terpotong");
  });

  it("covers every BurnError variant (fails to compile if a variant is ever added without copy)", () => {
    const errors: BurnError[] = [
      { type: "insufficient_points", short: 1 },
      { type: "holdback_blocks", unlocksAt: "2026-09-22T10:00:00.000Z" },
      { type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" },
      { type: "listing_unavailable", status: "sold_out" },
      { type: "redemption_failed" },
    ];
    for (const error of errors) {
      const { unmount } = render(<BurnErrorMessage error={error} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      unmount();
    }
  });
});
