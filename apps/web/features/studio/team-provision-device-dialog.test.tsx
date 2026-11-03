import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import enStudio from "@/messages/en-AU/studio.json";
import idStudio from "@/messages/id-ID/studio.json";
import { TeamProvisionDeviceDialog } from "./team-provision-device-dialog";

const locations = [
  { id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10", name: "Kemang" },
] as unknown as MerchantLocation[];

async function provisioned(locale: "en-AU" | "id-ID") {
  const onProvision = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      deviceId: "d1",
      pairingCode: "ABCD-1234",
      // 04:30 UTC on 20 Oct is 3:30 pm in Sydney (UTC+11).
      pairingExpiresAt: "2026-10-20T04:30:00.000Z",
    },
  });
  render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="Australia/Sydney"
      messages={{ studio: locale === "en-AU" ? enStudio : idStudio }}
    >
      <TeamProvisionDeviceDialog
        open
        locations={locations}
        onOpenChange={vi.fn()}
        onProvision={onProvision}
      />
    </NextIntlClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "Counter 1");
  const [pin, confirm] = screen.getAllByLabelText(/PIN|Konfirmasi/);
  await user.type(pin!, "1234");
  await user.type(confirm!, "1234");
  await user.click(screen.getByRole("button", { name: /Provision device|Siapkan perangkat/ }));
}

describe("TeamProvisionDeviceDialog", () => {
  it("writes the pairing code's expiry in the display language, not the browser's", async () => {
    await provisioned("en-AU");
    expect(await screen.findByText("Expires 20 Oct 2026, 3:30 pm.")).toBeInTheDocument();
  });

  it("writes the expiry in Indonesian for an Indonesian viewer", async () => {
    await provisioned("id-ID");
    expect(await screen.findByText(/20 Okt 2026, 15\.30/)).toBeInTheDocument();
  });

  it("says what the PIN is for, so an owner does not take it for the pairing code (Group 5.13.g, B13)", () => {
    render(
      <NextIntlClientProvider locale="en-AU" messages={{ studio: enStudio }}>
        <TeamProvisionDeviceDialog
          open
          locations={locations}
          onOpenChange={vi.fn()}
          onProvision={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText("Shift PIN (4–8 digits)")).toHaveAccessibleDescription(
      /unlock the counter after it locks/,
    );
    expect(
      screen.getByText(/opens straight away; after that it asks for this PIN/),
    ).toBeInTheDocument();
  });
});
