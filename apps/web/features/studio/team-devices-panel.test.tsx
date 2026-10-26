import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterDevice } from "@yourtal/contracts/device/counter-device";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import enStudio from "@/messages/en-AU/studio.json";
import idStudio from "@/messages/id-ID/studio.json";

const revokeDeviceLive = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("./devices-data", () => ({
  provisionDeviceLive: vi.fn(),
  revokeDeviceLive: (...args: unknown[]): unknown => revokeDeviceLive(...args),
}));

import { TeamDevicesPanel } from "./team-devices-panel";

const location = { id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10", name: "Kemang" };
const device: CounterDevice = {
  id: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  region: "AU",
  locationId: location.id,
  label: "Front counter",
  state: "paired",
  createdBy: "owner",
  createdAt: "2026-10-20T00:00:00.000Z",
  pairedAt: "2026-10-20T00:05:00.000Z",
  revokedAt: null,
};

function renderPanel(locale: "en-AU" | "id-ID" = "en-AU") {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ studio: locale === "en-AU" ? enStudio : idStudio }}
    >
      <TeamDevicesPanel
        businessId={device.businessId}
        initialDevices={[device]}
        locations={[location as unknown as MerchantLocation]}
      />
    </NextIntlClientProvider>,
  );
}

describe("TeamDevicesPanel revoke (Group 5.13.g, B18)", () => {
  beforeEach(() => {
    revokeDeviceLive.mockReset().mockResolvedValue({ ok: true, data: {} });
  });

  it("does not revoke on the first click: it asks, and says it can't be undone", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke Front counter?")).toBeInTheDocument();
    expect(within(dialog).getByText(/This can't be undone/u)).toBeInTheDocument();
    expect(revokeDeviceLive).not.toHaveBeenCalled();
  });

  it("keeps the device when the owner backs out", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(await screen.findByRole("button", { name: "Keep device" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(revokeDeviceLive).not.toHaveBeenCalled();
    expect(screen.getByText("Paired")).toBeInTheDocument();
  });

  it("revokes only once confirmed", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(await screen.findByRole("button", { name: "Revoke device" }));

    await waitFor(() => expect(screen.getByText("Revoked")).toBeInTheDocument());
    expect(revokeDeviceLive).toHaveBeenCalledOnce();
    expect(revokeDeviceLive).toHaveBeenCalledWith(device.businessId, device.id);
  });

  it("asks in Indonesian for an Indonesian owner", async () => {
    renderPanel("id-ID");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cabut" }));
    expect(await screen.findByText(/tidak bisa dibatalkan/u)).toBeInTheDocument();
    expect(revokeDeviceLive).not.toHaveBeenCalled();
  });
});
