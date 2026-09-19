import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MerchantDevice } from "../merchant-device";
import { MerchantSessionChrome } from "./merchant-session-chrome";

const device: MerchantDevice = {
  id: "counter-toko-berkah-1",
  label: "Toko Berkah — Kasir 1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  locale: "en-AU",
  currency: "AUD",
  countryName: "Australia",
};

/**
 * Rendering-only, same reasoning as its sibling tests — `lockDeviceAction`
 * (bound to the "Lock now" form and passed to `AutoLockWatcher`) is a real
 * `"use server"` export and is never invoked here. `AutoLockWatcher`
 * itself is exercised directly by `use-auto-lock.test.ts`.
 */
describe("MerchantSessionChrome", () => {
  it("renders the device label, a Lock now control, and the wrapped children", () => {
    render(
      <MerchantSessionChrome device={device}>
        <p>redemption screen content</p>
      </MerchantSessionChrome>,
    );
    expect(screen.getByText(device.label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock now" })).toBeInTheDocument();
    expect(screen.getByText("redemption screen content")).toBeInTheDocument();
  });

  it("renders the id-ID lock button label for an Indonesian device", () => {
    render(
      <MerchantSessionChrome device={{ ...device, locale: "id-ID" }}>
        <p>content</p>
      </MerchantSessionChrome>,
    );
    expect(screen.getByRole("button", { name: "Kunci sekarang" })).toBeInTheDocument();
  });
});
