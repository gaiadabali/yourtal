import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantDevice } from "./merchant-device";
import { MerchantRedemptionScreen } from "./merchant-redemption-screen";
import {
  alreadyRedeemedVoucherFixture,
  healthyVoucherFixture,
  wrongMerchantVoucherFixture,
} from "./merchant-voucher-fixtures";
import { readTodayLog } from "./merchant-today-log";

const device: MerchantDevice = {
  id: "test-device",
  label: "Test Counter",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  locale: "en-AU",
  currency: "AUD",
  countryName: "Australia",
};

const vouchers = [
  healthyVoucherFixture,
  wrongMerchantVoucherFixture,
  alreadyRedeemedVoucherFixture,
];

// A fixed instant known (by direct computation against merchant-redemption.ts's
// deterministic hash) NOT to land in the simulated network-failure bucket
// for `healthyVoucherFixture`'s id — see the ticket's report for how this
// was derived. Keeps the happy-path test from being a 1-in-12 flake.
const SAFE_NOW_MS = Date.parse("2026-09-19T09:05:00.000Z");

function setUpDevice() {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
}

describe("MerchantRedemptionScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setUpDevice();
    vi.spyOn(Date, "now").mockReturnValue(SAFE_NOW_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // YT-0577: this file used to hand-bump these waits to `{ timeout: 3000 }`
  // / `it(..., 10000)` and STILL failed under load — evidence that a
  // per-file timeout bump chases a moving target rather than fixing the
  // class. Every wait below now relies on the suite-wide policy in
  // `vitest.setup.ts` (`asyncUtilTimeout: 5000`) and `vitest.config.ts`
  // (`testTimeout: 15000`), which is strictly more generous than the old
  // local overrides and is proven (not merely intended) to cover the
  // simulated `PROCESSING_PHASE_DELAY_MS` network delay under contention.
  it("completes a full redemption in two taps — look up, then confirm — and never shows success before processing finishes", async () => {
    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} vouchers={vouchers} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), healthyVoucherFixture.code);
    await user.click(screen.getByRole("button", { name: "Look up voucher" })); // tap 1

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    await user.click(confirmButton); // tap 2

    // Processing must be visibly shown before any success claim.
    expect(await screen.findByText(/Verifying voucher|Completing redemption/)).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());

    const log = readTodayLog(device.id, "2026-09-19");
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe("confirmed");
    expect(log[0]?.voucherCode).toBe(healthyVoucherFixture.code);
  });

  it("shows a plain-language, specific message for a wrong-merchant voucher, not just 'invalid'", async () => {
    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} vouchers={vouchers} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), wrongMerchantVoucherFixture.code);
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    await user.click(confirmButton);

    await waitFor(() => expect(screen.getByText(/is for a different store/i)).toBeInTheDocument());
    expect(
      screen.getByText(new RegExp(wrongMerchantVoucherFixture.merchantName)),
    ).toBeInTheDocument();
  });

  it("shows already-redeemed with a specific message when the voucher's own status says so", async () => {
    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} vouchers={vouchers} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), alreadyRedeemedVoucherFixture.code);
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    await user.click(confirmButton);

    await waitFor(() => expect(screen.getByText(/already redeemed/i)).toBeInTheDocument());
  });

  it("shows a 'not found' message, not a blank screen, for a code that matches nothing", async () => {
    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} vouchers={vouchers} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "NOSUCHCODE");
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    await waitFor(() => expect(screen.getByText("Code not found")).toBeInTheDocument());
  });

  it("queues, rather than claims success, when confirming while offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} vouchers={vouchers} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), healthyVoucherFixture.code);
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    await user.click(confirmButton);

    expect(await screen.findByText("Waiting for connection")).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    const log = readTodayLog(device.id, "2026-09-19");
    expect(log).toHaveLength(1);
    expect(log[0]?.status).toBe("pending");
  });
});
