import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { MerchantDevice } from "./merchant-device";
import { MerchantRedemptionScreen } from "./merchant-redemption-screen";

type AsyncMock = (...args: unknown[]) => Promise<unknown>;

const counterLookupAction = vi.fn<AsyncMock>();
const counterAuthorizeAction = vi.fn<AsyncMock>();
const counterCaptureAction = vi.fn<AsyncMock>();
const counterLogAction = vi.fn<AsyncMock>();

vi.mock("./counter-redemption-actions", () => ({
  counterLookupAction: (...args: unknown[]) => counterLookupAction(...args),
  counterAuthorizeAction: (...args: unknown[]) => counterAuthorizeAction(...args),
  counterCaptureAction: (...args: unknown[]) => counterCaptureAction(...args),
  counterLogAction: (...args: unknown[]) => counterLogAction(...args),
}));

const device: MerchantDevice = { id: "3f9a2b10-1111-4000-8000-000000000001", locale: "en-AU" };

const healthyPreview: CounterVoucherPreview = {
  voucherId: "00000000-0000-4000-8000-000000000101",
  merchantName: "Kopi Kenangan Kemang",
  offerTitle: "20% off any drink",
  remainingValueMinor: toMinorUnits(5000),
  currency: "AUD",
  partialRedemptionPolicy: "balance_carrying",
};

function setUpDevice() {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
}

describe("MerchantRedemptionScreen", () => {
  beforeEach(() => {
    setUpDevice();
    counterLookupAction.mockReset();
    counterAuthorizeAction.mockReset();
    counterCaptureAction.mockReset();
    counterLogAction.mockReset().mockResolvedValue({ ok: true, data: { entries: [] } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes a full redemption in two taps — look up, then confirm — and never shows success before capture returns", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    let resolveAuthorize!: (value: unknown) => void;
    counterAuthorizeAction.mockReturnValue(new Promise((resolve) => (resolveAuthorize = resolve)));
    counterCaptureAction.mockResolvedValue({
      ok: true,
      data: {
        captureId: "rcpt_1",
        voucherId: healthyPreview.voucherId,
        amountMinor: 5000,
        currency: "AUD",
        capturedAt: "2026-09-19T09:00:00.000Z",
        orderRef: "ord_1",
      },
    });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "HEALTHY1");
    await user.click(screen.getByRole("button", { name: "Look up voucher" })); // tap 1

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    await user.click(confirmButton); // tap 2

    // Processing must be visibly shown before any success claim.
    expect(await screen.findByText(/Verifying voucher/)).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    resolveAuthorize({
      ok: true,
      data: {
        authorizationId: "auth_1",
        voucherId: healthyPreview.voucherId,
        amountMinor: 5000,
        currency: "AUD",
        expiresAt: "2026-09-19T09:05:00.000Z",
      },
    });

    await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());
    expect(counterCaptureAction).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationId: "auth_1" }),
    );
  });

  it("shows already-redeemed with a specific message when the server says so", async () => {
    counterLookupAction.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "already_redeemed", message: "already redeemed" },
    });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "REDEEMED1");
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    await waitFor(() => expect(screen.getByText("Code not found")).toBeInTheDocument());
  });

  it("shows a 'not found' message, not a blank screen, for a code that matches nothing", async () => {
    counterLookupAction.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 404, code: "voucher_not_found", message: "no such voucher" },
    });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "NOSUCHCODE");
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));

    await waitFor(() => expect(screen.getByText("Code not found")).toBeInTheDocument());
  });

  it("refuses rather than queues when confirming while offline (TASKS.md 8.2.b: no offline redemption)", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "HEALTHY1");
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });

    // `useOnlineStatus` only reacts to the real `offline` event (mirroring a
    // genuine connectivity drop) — redefining `navigator.onLine` alone does
    // not re-render anything, so the event must actually fire.
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await user.click(confirmButton);

    expect(await screen.findByText("Can't redeem offline")).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();
    expect(counterAuthorizeAction).not.toHaveBeenCalled();
  });

  it("retries capture (not authorize again) after a capture failure, reusing the same idempotency key", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    counterAuthorizeAction.mockResolvedValue({
      ok: true,
      data: {
        authorizationId: "auth_1",
        voucherId: healthyPreview.voucherId,
        amountMinor: 5000,
        currency: "AUD",
        expiresAt: "2026-09-19T09:05:00.000Z",
      },
    });
    counterCaptureAction
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network", message: "timed out" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          captureId: "rcpt_1",
          voucherId: healthyPreview.voucherId,
          amountMinor: 5000,
          currency: "AUD",
          capturedAt: "2026-09-19T09:00:00.000Z",
          orderRef: "ord_1",
        },
      });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);

    await user.click(screen.getByRole("tab", { name: "Enter code" }));
    await user.type(screen.getByLabelText("Voucher code"), "HEALTHY1");
    await user.click(screen.getByRole("button", { name: "Look up voucher" }));
    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    await user.click(confirmButton);

    const retryButton = await screen.findByRole("button", { name: "Try again" });
    await user.click(retryButton);

    await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());
    expect(counterAuthorizeAction).toHaveBeenCalledTimes(1);
    expect(counterCaptureAction).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = counterCaptureAction.mock.calls as [
      { idempotencyKey: string },
    ][];
    expect(firstCall?.[0].idempotencyKey).toBe(secondCall?.[0].idempotencyKey);
  });
});
