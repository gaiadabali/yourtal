import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MerchantDevice } from "../merchant-device";
import { PinUnlockScreen } from "./pin-unlock-screen";

const device: MerchantDevice = {
  id: "counter-toko-berkah-1",
  label: "Toko Berkah — Kasir 1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  locale: "en-AU",
  currency: "AUD",
  countryName: "Australia",
  location: {
    id: "00000000-0000-4000-8000-0000000006a1",
    name: "Test Merchant — Surry Hills",
    address: "1 Surry Hills Street",
    district: "Surry Hills",
  },
};

/** Rendering-only — see `device-provisioning-form.test.tsx`'s doc comment on why the `unlockWithPin` Server Action is never invoked here. */
describe("PinUnlockScreen", () => {
  it("shows the device label and the shift-lock, not-a-login copy", () => {
    render(<PinUnlockScreen device={device} />);
    expect(screen.getByText(new RegExp(device.label))).toBeInTheDocument();
    expect(screen.getByText(/isn't a personal account/i)).toBeInTheDocument();
  });

  it("renders a PIN field and unlock button", () => {
    render(<PinUnlockScreen device={device} />);
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("shows no error banner by default", () => {
    render(<PinUnlockScreen device={device} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the wrong-PIN message", () => {
    render(<PinUnlockScreen device={device} error="wrong_pin" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong PIN. Try again.");
  });

  it("shows the too-many-attempts message", () => {
    render(<PinUnlockScreen device={device} error="too_many_attempts" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/too many/i);
  });

  it("renders id-ID copy for an Indonesian device", () => {
    render(<PinUnlockScreen device={{ ...device, locale: "id-ID" }} error="wrong_pin" />);
    expect(screen.getByRole("alert")).toHaveTextContent("PIN salah. Coba lagi.");
  });
});
