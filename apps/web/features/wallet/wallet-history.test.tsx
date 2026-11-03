import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { walletHistoryEntrySchema } from "@yourtal/contracts/wallet/wallet-history";
import { WalletHistory } from "./wallet-history";
import { walletTestTranslator } from "./wallet-test-translator";

vi.mock("next-intl/server", () => ({ getTranslations: () => walletTestTranslator("id-ID") }));

/** 17:04 UTC is 00:04 the next morning in Jakarta and 4:04 am in Sydney. */
const entry = walletHistoryEntrySchema.parse({
  id: "grt_1",
  kind: "earn",
  occurredAt: "2026-10-21T17:04:00.000Z",
  points: 10,
  direction: "credit",
});

async function renderHistory(region: "AU" | "ID", locale: "en-AU" | "id-ID") {
  render(
    <>
      {await WalletHistory({
        entries: [entry],
        filter: "all",
        filterHref: () => "/wallet",
        olderHref: null,
        region,
        locale,
        nowMs: Date.parse("2026-10-22T03:00:00.000Z"),
      })}
    </>,
  );
}

describe("the time on a points history line (V25)", () => {
  it("reads as a clock time in Bahasa, not as the number 0.04", async () => {
    await renderHistory("ID", "id-ID");
    expect(screen.getByText("00.04")).toBeInTheDocument();
    expect(screen.queryByText("0.04")).not.toBeInTheDocument();
  });

  it("reads as a 12-hour clock time in Australia", async () => {
    await renderHistory("AU", "en-AU");
    expect(screen.getByText("4:04 am")).toBeInTheDocument();
  });
});
