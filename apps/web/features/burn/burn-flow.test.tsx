import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import { RegionProvider } from "@/features/region/region-context";
import idID from "@/messages/id-ID/burn.json";
import enAU from "@/messages/en-AU/burn.json";
import { BurnFlow } from "./burn-flow";
import { makeBalanceFixture, makeListingFixture } from "./burn-test-fixtures";
import { confirmCheckoutAction } from "./confirm-checkout-action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./confirm-checkout-action", () => ({
  confirmCheckoutAction: vi.fn(),
}));

const mockConfirm = vi.mocked(confirmCheckoutAction);

const CHECKOUT_ID = "00000000-0000-4000-9000-000000000001";
const VOUCHER_ID = "00000000-0000-4000-9000-000000000002";

/**
 * `BurnFlow` renders `BurnSummary`/`BurnErrorMessage`, both Client
 * Components that read the region and its translations ambiently (YT-0405)
 * — the same `RegionProvider`/`NextIntlClientProvider` pair
 * `app/(app)/layout.tsx` mounts once for the whole app. `BurnFlow`'s own
 * copy (the buttons/disclaimer/success message in `BurnFlowStep`) now reads
 * `useTranslations("burn")` the same way. Defaults to "ID" so every existing
 * assertion below (still Indonesian) is unaffected.
 */
function renderBurnFlow(ui: ReactElement, region: Region = "ID") {
  const locale = region === "AU" ? "en-AU" : "id-ID";
  const messages = { burn: region === "AU" ? enAU : idID };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

const NOW = new Date("2026-09-19T10:00:00.000Z");
/**
 * Real wall-clock relative expiry for every test OUTSIDE the "price-lock
 * expiry" describe block below — those tests never mock the clock, so a
 * `lockExpiresAt` anchored to the fixed historical `NOW` (used only where
 * `vi.setSystemTime(NOW)` is also in effect) would already read as expired
 * against the real current instant.
 */
function freshLockExpiresAt(): string {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

describe("BurnFlow", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
  });

  it("shows the price-lock countdown and a Lanjutkan button when the wallet already covers the price", () => {
    const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });

    renderBurnFlow(
      <BurnFlow
        listing={listing}
        balance={balance}
        checkoutId={CHECKOUT_ID}
        pricePoints={toPoints(1_000)}
        lockExpiresAt={freshLockExpiresAt()}
      />,
    );

    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan" })).toBeInTheDocument();
  });

  it("blocks immediately, with a plain-language holdback explanation, when only pending points would cover the price", () => {
    const listing = makeListingFixture({ priceInPoints: toPoints(9_000) });
    const balance = makeBalanceFixture({
      availablePoints: toPoints(8_400),
      pendingPoints: toPoints(1_200),
      pendingUnlockAt: "2026-09-22T00:00:00.000Z",
    });

    renderBurnFlow(
      <BurnFlow
        listing={listing}
        balance={balance}
        checkoutId={CHECKOUT_ID}
        pricePoints={toPoints(9_000)}
        lockExpiresAt={freshLockExpiresAt()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sebagian poin Anda masih ditahan sementara",
    );
    expect(screen.queryByRole("button", { name: "Lanjutkan" })).not.toBeInTheDocument();
  });

  it("walks reviewing -> confirming -> success, restating the same locked price at confirmation, and calls the server exactly once", async () => {
    mockConfirm.mockResolvedValue({
      ok: true,
      result: {
        checkoutId: CHECKOUT_ID,
        state: "done",
        voucherId: VOUCHER_ID,
        pricePoints: toPoints(1_000),
      },
    });
    const user = userEvent.setup();
    const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });

    renderBurnFlow(
      <BurnFlow
        listing={listing}
        balance={balance}
        checkoutId={CHECKOUT_ID}
        pricePoints={toPoints(1_000)}
        lockExpiresAt={freshLockExpiresAt()}
      />,
    );

    expect(screen.getByText("1.000 poin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(screen.getByRole("heading", { name: "Konfirmasi penukaran" })).toBeInTheDocument();
    // Same figure, restated, not re-derived.
    expect(screen.getByText("1.000 poin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tukar sekarang" }));

    expect(await screen.findByText("Berhasil")).toBeInTheDocument();
    const walletLink = screen.getByRole("link", { name: "Lihat di Dompet" });
    expect(walletLink).toHaveAttribute("href", `/wallet/voucher/${VOUCHER_ID}`);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(CHECKOUT_ID);
  });

  it("shows a plain-language refusal, not a crash, when the server refuses the confirm", async () => {
    mockConfirm.mockResolvedValue({
      ok: false,
      error: {
        kind: "http",
        status: 409,
        code: "insufficient_available",
        message: "not enough points to spend",
      },
    });
    const user = userEvent.setup();
    const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });

    renderBurnFlow(
      <BurnFlow
        listing={listing}
        balance={balance}
        checkoutId={CHECKOUT_ID}
        pricePoints={toPoints(1_000)}
        lockExpiresAt={freshLockExpiresAt()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await user.click(screen.getByRole("button", { name: "Tukar sekarang" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Saldo Anda berubah");
    expect(screen.queryByRole("button", { name: "Tukar sekarang" })).not.toBeInTheDocument();
  });

  describe("price-lock expiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("transitions to the unrecoverable lock_expired state when the countdown reaches zero, and offers only a re-quote", () => {
      const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
      const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
      const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();

      renderBurnFlow(
        <BurnFlow
          listing={listing}
          balance={balance}
          checkoutId={CHECKOUT_ID}
          pricePoints={toPoints(1_000)}
          lockExpiresAt={lockExpiresAt}
        />,
      );
      expect(screen.getByRole("button", { name: "Lanjutkan" })).toBeInTheDocument();

      advanceSeconds(3);

      expect(screen.getByRole("alert")).toHaveTextContent("Harga ini sudah tidak berlaku");
      expect(screen.queryByRole("button", { name: "Lanjutkan" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Tukar sekarang" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Muat ulang harga" })).toBeInTheDocument();
    });

    it("confirming does not reset the lock's own clock: a lock started before confirming can still expire mid-confirmation", () => {
      // `fireEvent`, not `userEvent`, here: userEvent's internal async
      // scheduling does not mix reliably with `vi.useFakeTimers()` (it hangs
      // waiting on a real timer that will never fire). `fireEvent.click` is
      // synchronous and exercises the same `onClick` handler.
      const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
      const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
      const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();

      renderBurnFlow(
        <BurnFlow
          listing={listing}
          balance={balance}
          checkoutId={CHECKOUT_ID}
          pricePoints={toPoints(1_000)}
          lockExpiresAt={lockExpiresAt}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
      });
      expect(screen.getByRole("heading", { name: "Konfirmasi penukaran" })).toBeInTheDocument();

      advanceSeconds(3);

      expect(screen.getByRole("alert")).toHaveTextContent("Harga ini sudah tidak berlaku");
      expect(screen.queryByRole("button", { name: "Tukar sekarang" })).not.toBeInTheDocument();
    });
  });
});

describe("BurnFlow (en-AU, YT-0405)", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
  });

  it("walks reviewing -> confirming -> success in English, with no Indonesian copy leaking through", async () => {
    mockConfirm.mockResolvedValue({
      ok: true,
      result: {
        checkoutId: CHECKOUT_ID,
        state: "done",
        voucherId: VOUCHER_ID,
        pricePoints: toPoints(1_000),
      },
    });
    const user = userEvent.setup();
    const listing = makeListingFixture({ priceInPoints: toPoints(1_000), currency: "AUD" });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });

    renderBurnFlow(
      <BurnFlow
        listing={listing}
        balance={balance}
        checkoutId={CHECKOUT_ID}
        pricePoints={toPoints(1_000)}
        lockExpiresAt={freshLockExpiresAt()}
      />,
      "AU",
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Confirm redemption" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Redeem now" }));

    expect(await screen.findByText("Success")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in Wallet" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /Lanjutkan|Tukar sekarang|Berhasil|Lihat di Dompet/,
    );
  });
});
