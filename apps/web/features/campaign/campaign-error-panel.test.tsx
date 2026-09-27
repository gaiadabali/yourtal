import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/campaign.json";
import { CampaignErrorPanel } from "./campaign-error-panel";

/** Reads the `campaign` namespace's retry label via `useTranslations` (6.1.d) — needs a provider ancestor. */
function renderPanel(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ campaign: idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CampaignErrorPanel", () => {
  it("announces itself as an alert with the given copy", () => {
    renderPanel(
      <CampaignErrorPanel title="Gagal memuat" description="Coba lagi." onRetry={() => {}} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal memuat");
  });

  it("is recoverable: the retry button calls the handler", () => {
    const onRetry = vi.fn();
    renderPanel(
      <CampaignErrorPanel title="Gagal memuat" description="Coba lagi." onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /coba lagi/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
