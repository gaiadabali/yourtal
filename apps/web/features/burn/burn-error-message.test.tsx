import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { Region } from "@yourtal/contracts/region";
import { RegionProvider } from "@/features/region/region-context";
import { regionDisplayConfig } from "@/features/region/region-config";
import enAU from "@/messages/en-AU/burn.json";
import idID from "@/messages/id-ID/burn.json";
import { BurnErrorMessage } from "./burn-error-message";
import type { BurnError } from "./burn-errors";

/**
 * YT-0405: `BurnErrorMessage` is a Client Component that reads its region
 * and translations ambiently (`useRegion()`/`useTranslations()`), exactly
 * as it does inside the real app via `app/(app)/layout.tsx`'s
 * `RegionProvider`/`NextIntlClientProvider` pair — so every render in this
 * file needs both providers, not just the bare component.
 */
function renderWithRegion(ui: ReactNode, region: Region = "ID") {
  const { locale } = regionDisplayConfig(region);
  const messages = { burn: region === "AU" ? enAU : idID };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

describe("BurnErrorMessage", () => {
  it("states the exact shortfall for insufficient_points", () => {
    renderWithRegion(<BurnErrorMessage error={{ type: "insufficient_points", short: 1_500 }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Poin Anda belum cukup");
    expect(screen.getByRole("alert")).toHaveTextContent("1.500 poin");
  });

  it("explains the holdback in plain language: no transaction jargon, states when it unlocks", () => {
    renderWithRegion(
      <BurnErrorMessage
        error={{ type: "holdback_blocks", unlocksAt: "2026-09-22T10:00:00.000Z" }}
      />,
    );
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
    renderWithRegion(
      <BurnErrorMessage error={{ type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Harga ini sudah tidak berlaku");
    expect(screen.getByRole("alert")).toHaveTextContent("Muat ulang");
  });

  it("tells the user an unavailable listing is out of stock", () => {
    renderWithRegion(
      <BurnErrorMessage error={{ type: "listing_unavailable", status: "sold_out" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("sudah tidak tersedia");
  });

  it("reassures that points were not deducted after a redemption failure", () => {
    renderWithRegion(<BurnErrorMessage error={{ type: "redemption_failed" }} />);
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
      const { unmount } = renderWithRegion(<BurnErrorMessage error={error} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("BurnErrorMessage (en-AU, YT-0405)", () => {
  it("states the exact shortfall for insufficient_points in English", () => {
    renderWithRegion(
      <BurnErrorMessage error={{ type: "insufficient_points", short: 1_500 }} />,
      "AU",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have enough points yet");
    expect(screen.getByRole("alert")).toHaveTextContent("1,500 points");
  });

  it("explains the holdback in plain, jargon-free English and states when it unlocks", () => {
    renderWithRegion(
      <BurnErrorMessage
        error={{ type: "holdback_blocks", unlocksAt: "2026-09-22T10:00:00.000Z" }}
      />,
      "AU",
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Some of your points are temporarily on hold");
    expect(alert).toHaveTextContent("prevent fraud");
    const forbiddenJargon = ["holdback", "settlement", "authorize", "capture", "ledger"];
    for (const term of forbiddenJargon) {
      expect(alert.textContent?.toLowerCase()).not.toContain(term);
    }
    // The unlock date is formatted in en-AU, not id-ID (docs/tasks/phase-u-ui.md YT-0405).
    expect(alert.textContent).toMatch(/September/);
  });

  it("explains an expired price lock in English and points to reloading", () => {
    renderWithRegion(
      <BurnErrorMessage error={{ type: "lock_expired", expiredAt: "2026-09-19T10:10:00.000Z" }} />,
      "AU",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This price is no longer valid");
    expect(screen.getByRole("alert")).toHaveTextContent("Reload");
  });

  it("tells the user an unavailable listing is out of stock in English", () => {
    renderWithRegion(
      <BurnErrorMessage error={{ type: "listing_unavailable", status: "sold_out" }} />,
      "AU",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  it("reassures that points were not deducted after a redemption failure, in English", () => {
    renderWithRegion(<BurnErrorMessage error={{ type: "redemption_failed" }} />, "AU");
    expect(screen.getByRole("alert")).toHaveTextContent("Redemption failed");
    expect(screen.getByRole("alert")).toHaveTextContent("have not been deducted");
  });
});
