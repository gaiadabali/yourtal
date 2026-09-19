import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/wallet.json";
import idID from "@/messages/id-ID/wallet.json";
import { VoucherValidityCountdown } from "./voucher-validity-countdown";

/** Reads its copy via `useTranslations("wallet")` (YT-0405) — needs `NextIntlClientProvider` in scope. */
function renderWithMessages(ui: ReactElement, locale: "en-AU" | "id-ID" = "id-ID") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ wallet: locale === "en-AU" ? enAU : idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VoucherValidityCountdown", () => {
  it("exposes an accessible progressbar with the correct current/max values", () => {
    renderWithMessages(
      <VoucherValidityCountdown secondsUntilRotation={12} rotationIntervalSeconds={30} />,
    );

    const progressbar = screen.getByRole("progressbar", {
      name: "Waktu sebelum kode QR diperbarui",
    });
    expect(progressbar).toHaveAttribute("aria-valuenow", "12");
    expect(progressbar).toHaveAttribute("aria-valuemax", "30");
  });

  it("shows the remaining seconds as visible text", () => {
    renderWithMessages(
      <VoucherValidityCountdown secondsUntilRotation={7} rotationIntervalSeconds={30} />,
    );

    expect(screen.getByText("7 detik lagi")).toBeInTheDocument();
  });

  it("clamps a stale negative or over-range value instead of rendering nonsense", () => {
    renderWithMessages(
      <VoucherValidityCountdown secondsUntilRotation={-2} rotationIntervalSeconds={30} />,
    );

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("VoucherValidityCountdown (en-AU, YT-0405)", () => {
  it("exposes an accessible progressbar labelled in English", () => {
    renderWithMessages(
      <VoucherValidityCountdown secondsUntilRotation={12} rotationIntervalSeconds={30} />,
      "en-AU",
    );

    expect(
      screen.getByRole("progressbar", { name: "Time until the QR code refreshes" }),
    ).toBeInTheDocument();
  });

  it("shows the remaining seconds as English visible text", () => {
    renderWithMessages(
      <VoucherValidityCountdown secondsUntilRotation={7} rotationIntervalSeconds={30} />,
      "en-AU",
    );

    expect(screen.getByText("7s remaining")).toBeInTheDocument();
  });
});
