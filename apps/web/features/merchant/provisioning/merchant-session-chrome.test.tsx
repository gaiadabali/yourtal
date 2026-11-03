import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildMerchantDevice } from "../merchant-device";
import { MerchantSessionChrome } from "./merchant-session-chrome";

const device = buildMerchantDevice({ id: "3f9a2b10-1111-4000-8000-000000000001", region: "AU" });

/**
 * Rendering-only, same reasoning as its sibling tests — `lockDeviceAction`
 * (bound to the "Lock now" form and passed to `AutoLockWatcher`) is a real
 * `"use server"` export and is never invoked here. `AutoLockWatcher`
 * itself is exercised directly by `use-auto-lock.test.ts`.
 */
describe("MerchantSessionChrome", () => {
  it("renders a device badge, a Lock now control, and the wrapped children", () => {
    render(
      <MerchantSessionChrome device={device}>
        <p>redemption screen content</p>
      </MerchantSessionChrome>,
    );
    expect(screen.getByText(device.id.slice(0, 8))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock now" })).toBeInTheDocument();
    expect(screen.getByText("redemption screen content")).toBeInTheDocument();
  });

  it("renders the id-ID lock button label for an Indonesian device", () => {
    render(
      <MerchantSessionChrome device={buildMerchantDevice({ id: device.id, region: "ID" })}>
        <p>content</p>
      </MerchantSessionChrome>,
    );
    expect(screen.getByRole("button", { name: "Kunci sekarang" })).toBeInTheDocument();
  });

  it("names the counter by its label, not its device id (Group 5.13.g)", () => {
    render(
      <MerchantSessionChrome
        device={buildMerchantDevice({ id: device.id, region: "AU", label: "Front counter" })}
      >
        <p>content</p>
      </MerchantSessionChrome>,
    );
    expect(screen.getByText("Front counter")).toBeInTheDocument();
    expect(screen.queryByText(device.id.slice(0, 8))).not.toBeInTheDocument();
  });
});
