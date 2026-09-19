import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { toPoints } from "@yourtal/contracts/money";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import { RegionProvider } from "@/features/region/region-context";
import idID from "@/messages/id-ID/burn.json";
import { BurnFlow } from "./burn-flow";
import { computeLockExpiresAt } from "./price-lock";
import { makeBalanceFixture, makeListingFixture } from "./burn-test-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * `BurnFlow` renders `BurnSummary`/`BurnErrorMessage`, both Client
 * Components that read the region and its translations ambiently (YT-0405)
 * — the same `RegionProvider`/`NextIntlClientProvider` pair
 * `app/(app)/layout.tsx` mounts once for the whole app. Defaults to "ID" so
 * every existing assertion below (still Indonesian) is unaffected.
 */
function renderBurnFlow(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ burn: idID }}>
      <RegionProvider region="ID">{ui}</RegionProvider>
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

/** A listing id guaranteed NOT to land in `attemptBurn`'s simulated-failure bucket, so success-path tests are not flaky. */
function successListingId(): string {
  for (let index = 0; index < 200; index += 1) {
    const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
    if (hashStringToSeed(`${id}:redemption-outcome`) % 8 !== 0) {
      return id;
    }
  }
  throw new Error("could not find a non-failing demo listing id");
}

const NOW = new Date("2026-09-19T10:00:00.000Z");

describe("BurnFlow", () => {
  it("shows the price-lock countdown and a Lanjutkan button when the wallet already covers the price", () => {
    const listing = makeListingFixture({ priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
    const lockExpiresAt = computeLockExpiresAt(new Date());

    renderBurnFlow(<BurnFlow listing={listing} balance={balance} lockExpiresAt={lockExpiresAt} />);

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
    const lockExpiresAt = computeLockExpiresAt(new Date());

    renderBurnFlow(<BurnFlow listing={listing} balance={balance} lockExpiresAt={lockExpiresAt} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sebagian poin Anda masih ditahan sementara",
    );
    expect(screen.queryByRole("button", { name: "Lanjutkan" })).not.toBeInTheDocument();
  });

  it("walks reviewing -> confirming -> success, restating the same cost at confirmation, for an eligible listing", async () => {
    const user = userEvent.setup();
    const listing = makeListingFixture({ id: successListingId(), priceInPoints: toPoints(1_000) });
    const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
    const lockExpiresAt = computeLockExpiresAt(new Date());

    renderBurnFlow(<BurnFlow listing={listing} balance={balance} lockExpiresAt={lockExpiresAt} />);

    expect(screen.getByText("1.000 poin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(screen.getByRole("heading", { name: "Konfirmasi penukaran" })).toBeInTheDocument();
    // Same figure, restated, not re-derived.
    expect(screen.getByText("1.000 poin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tukar sekarang" }));

    expect(await screen.findByText("Berhasil")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lihat di Dompet" })).toBeInTheDocument();
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
      const listing = makeListingFixture({
        id: successListingId(),
        priceInPoints: toPoints(1_000),
      });
      const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
      const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();

      renderBurnFlow(
        <BurnFlow listing={listing} balance={balance} lockExpiresAt={lockExpiresAt} />,
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
      const listing = makeListingFixture({
        id: successListingId(),
        priceInPoints: toPoints(1_000),
      });
      const balance = makeBalanceFixture({ availablePoints: toPoints(5_000) });
      const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();

      renderBurnFlow(
        <BurnFlow listing={listing} balance={balance} lockExpiresAt={lockExpiresAt} />,
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
