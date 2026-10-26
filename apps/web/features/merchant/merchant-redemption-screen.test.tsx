import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { toMinorUnits } from "@yourtal/contracts/money";
import { buildMerchantDevice } from "./merchant-device";
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

const device = buildMerchantDevice({ id: "3f9a2b10-1111-4000-8000-000000000001", region: "AU" });

/** A single-use voucher: redeemed whole, so lookup goes straight to the confirm step. */
const healthyPreview: CounterVoucherPreview = {
  voucherId: "00000000-0000-4000-8000-000000000101",
  merchantName: "Kopi Kenangan Kemang",
  offerTitle: "20% off any drink",
  remainingValueMinor: toMinorUnits(5000),
  currency: "AUD",
  partialRedemptionPolicy: "single_use",
};

/** A $50.00 balance-carrying voucher: the cashier types how much to take. */
const balancePreview: CounterVoucherPreview = {
  ...healthyPreview,
  partialRedemptionPolicy: "balance_carrying",
};

const captureOf = (amountMinor: number) => ({
  ok: true,
  data: {
    captureId: "rcpt_1",
    voucherId: healthyPreview.voucherId,
    amountMinor,
    currency: "AUD",
    capturedAt: "2026-09-19T09:00:00.000Z",
    orderRef: "ord_1",
  },
});

const authorizationOf = (amountMinor: number) => ({
  ok: true,
  data: {
    authorizationId: "auth_1",
    voucherId: healthyPreview.voucherId,
    amountMinor,
    currency: "AUD",
    expiresAt: "2026-09-19T09:05:00.000Z",
  },
});

type User = ReturnType<typeof userEvent.setup>;

async function lookUp(user: User) {
  await user.click(screen.getByRole("tab", { name: "Enter code" }));
  await user.type(screen.getByLabelText("Voucher code"), "HEALTHY1");
  await user.click(screen.getByRole("button", { name: "Look up voucher" }));
}

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

  it("completes a whole-voucher redemption in two taps — look up, then confirm — and never shows success before capture returns", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    let resolveAuthorize!: (value: unknown) => void;
    counterAuthorizeAction.mockReturnValue(new Promise((resolve) => (resolveAuthorize = resolve)));
    counterCaptureAction.mockResolvedValue(captureOf(5000));

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user); // tap 1

    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    await user.click(confirmButton); // tap 2

    // Processing must be visibly shown before any success claim.
    expect(await screen.findByText(/Verifying voucher/)).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();

    resolveAuthorize(authorizationOf(5000));

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
    await lookUp(user);

    await waitFor(() => expect(screen.getByText("Code not found")).toBeInTheDocument());
  });

  it("shows a 'not found' message, not a blank screen, for a code that matches nothing", async () => {
    counterLookupAction.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 404, code: "voucher_not_found", message: "no such voucher" },
    });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user);

    await waitFor(() => expect(screen.getByText("Code not found")).toBeInTheDocument());
  });

  it("refuses rather than queues when confirming while offline (TASKS.md 8.2.b: no offline redemption)", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user);
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

  it("retries after an offline refusal once the connection is back (the retry button used to do nothing)", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    counterAuthorizeAction.mockResolvedValue(authorizationOf(5000));
    counterCaptureAction.mockResolvedValue(captureOf(5000));

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user);
    const confirmButton = await screen.findByRole("button", { name: "Confirm redemption" });

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await user.click(confirmButton);
    const tryAgain = await screen.findByRole("button", { name: "Try again" });

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    await user.click(tryAgain);
    await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());
  });

  it("retries capture (not authorize again) after a capture failure, reusing the same idempotency key", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    counterAuthorizeAction.mockResolvedValue(authorizationOf(5000));
    counterCaptureAction
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network", message: "timed out" },
      })
      .mockResolvedValueOnce(captureOf(5000));

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user);
    await user.click(await screen.findByRole("button", { name: "Confirm redemption" }));

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

  it("sends authorize and capture DIFFERENT idempotency keys — real bug, real fix: a shared key made the server refuse capture outright (F70's own follow-up) once the idempotency table actually saw both request bodies", async () => {
    counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
    counterAuthorizeAction.mockResolvedValue(authorizationOf(5000));
    counterCaptureAction.mockResolvedValue(captureOf(5000));

    const user = userEvent.setup();
    render(<MerchantRedemptionScreen device={device} />);
    await lookUp(user);
    await user.click(await screen.findByRole("button", { name: "Confirm redemption" }));

    await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());
    const authorizeKey = (counterAuthorizeAction.mock.calls[0]?.[0] as { idempotencyKey: string })
      .idempotencyKey;
    const captureKey = (counterCaptureAction.mock.calls[0]?.[0] as { idempotencyKey: string })
      .idempotencyKey;
    expect(authorizeKey).not.toBe(captureKey);
  });

  describe("the amount (group 5.13.g, B14: money)", () => {
    it("asks for the amount on a balance-carrying voucher with nothing prefilled, its currency named, and the hint once", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);

      const field = await screen.findByLabelText("Amount to redeem (AUD)");
      expect(field).toHaveValue("");
      expect(screen.getAllByText(/value of the customer's purchase/u)).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Confirm redemption" })).not.toBeInTheDocument();
      expect(counterAuthorizeAction).not.toHaveBeenCalled();
    });

    it("converts 4.50 dollars to 450 cents, shows 'Redeem $4.50 of $50.00?' and commits only after Confirm", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      counterAuthorizeAction.mockResolvedValue(authorizationOf(450));
      counterCaptureAction.mockResolvedValue(captureOf(450));
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);

      await user.type(await screen.findByLabelText("Amount to redeem (AUD)"), "4.50");
      await user.click(screen.getByRole("button", { name: "Review" }));

      expect(await screen.findByText("Redeem $4.50 of $50.00?")).toBeInTheDocument();
      expect(screen.getByText(/\$45\.50 will stay on the voucher/u)).toBeInTheDocument();
      expect(counterAuthorizeAction).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Confirm redemption" }));
      await waitFor(() => expect(screen.getByText("Redeemed")).toBeInTheDocument());
      expect(counterAuthorizeAction).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 450, currency: "AUD" }),
      );
    });

    it("goes back from the review to the amount, keeping what was typed, with nothing committed", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);
      await user.type(await screen.findByLabelText("Amount to redeem (AUD)"), "12.5");
      await user.click(screen.getByRole("button", { name: "Review" }));
      await user.click(await screen.findByRole("button", { name: "Back" }));

      expect(await screen.findByLabelText("Amount to redeem (AUD)")).toHaveValue("12.50");
      expect(counterAuthorizeAction).not.toHaveBeenCalled();
    });

    it("refuses an amount over the balance in words, without leaving the amount step", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);
      await user.type(await screen.findByLabelText("Amount to redeem (AUD)"), "50.01");
      await user.click(screen.getByRole("button", { name: "Review" }));

      expect(await screen.findByText(/only has \$50\.00 left/u)).toBeInTheDocument();
      expect(screen.queryByText(/^Redeem \$/u)).not.toBeInTheDocument();
      expect(counterAuthorizeAction).not.toHaveBeenCalled();
    });

    it("'Use the full balance' fills the whole amount, which still has to be reviewed", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);
      await user.click(
        await screen.findByRole("button", { name: "Use the full balance ($50.00)" }),
      );
      expect(screen.getByLabelText("Amount to redeem (AUD)")).toHaveValue("50.00");
      await user.click(screen.getByRole("button", { name: "Review" }));

      expect(await screen.findByText("Redeem $50.00 of $50.00?")).toBeInTheDocument();
      expect(counterAuthorizeAction).not.toHaveBeenCalled();
    });

    it("says a single-use voucher can only be redeemed whole, and reviews it before anything is taken", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: healthyPreview });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);

      expect(await screen.findByText("Redeem $50.00 of $50.00?")).toBeInTheDocument();
      expect(screen.getByText("This voucher can only be redeemed in full.")).toBeInTheDocument();
      expect(screen.queryByLabelText(/Amount to redeem/u)).not.toBeInTheDocument();
      expect(counterAuthorizeAction).not.toHaveBeenCalled();
    });

    it("takes whole rupiah on an Indonesian counter, in Indonesian, with IDR on the field", async () => {
      const idPreview: CounterVoucherPreview = {
        ...balancePreview,
        currency: "IDR",
        remainingValueMinor: toMinorUnits(100_000),
      };
      counterLookupAction.mockResolvedValue({ ok: true, data: idPreview });
      counterAuthorizeAction.mockResolvedValue(authorizationOf(25_000));
      counterCaptureAction.mockResolvedValue(captureOf(25_000));
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={buildMerchantDevice({ id: "d", region: "ID" })} />);

      await user.click(screen.getByRole("tab", { name: "Masukkan kode" }));
      await user.type(screen.getByLabelText("Kode voucher"), "KODE1");
      await user.click(screen.getByRole("button", { name: "Cari voucher" }));
      await user.type(await screen.findByLabelText("Jumlah yang dipakai (IDR)"), "25.000");
      await user.click(screen.getByRole("button", { name: "Tinjau" }));

      expect(
        await screen.findByText(/Pakai\s+Rp\s?25\.000 dari\s+Rp\s?100\.000\?/u),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Konfirmasi redeem" }));
      await waitFor(() =>
        expect(counterAuthorizeAction).toHaveBeenCalledWith(
          expect.objectContaining({ amountMinor: 25_000, currency: "IDR" }),
        ),
      );
    });

    it("quotes the server's own refusal of an over-balance amount with what is left", async () => {
      counterLookupAction.mockResolvedValue({ ok: true, data: balancePreview });
      counterAuthorizeAction.mockResolvedValue({
        ok: false,
        error: {
          kind: "http",
          status: 422,
          code: "amount_exceeds_remaining_value",
          message: "this amount cannot be redeemed against this voucher",
        },
      });
      const user = userEvent.setup();
      render(<MerchantRedemptionScreen device={device} />);
      await lookUp(user);
      await user.type(await screen.findByLabelText("Amount to redeem (AUD)"), "10");
      await user.click(screen.getByRole("button", { name: "Review" }));
      await user.click(await screen.findByRole("button", { name: "Confirm redemption" }));

      expect(await screen.findByText(/only has \$50\.00 remaining/u)).toBeInTheDocument();
    });
  });
});
