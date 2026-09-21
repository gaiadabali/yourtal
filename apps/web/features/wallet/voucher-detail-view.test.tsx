import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Voucher } from "@yourtal/contracts/voucher";
import type { Region } from "@yourtal/contracts/region";
import { mockVouchers } from "@yourtal/contracts/voucher/mock";
import { RegionProvider } from "@/features/region/region-context";
import { regionDisplayConfig } from "@/features/region/region-config";
import enAU from "@/messages/en-AU/wallet.json";
import idID from "@/messages/id-ID/wallet.json";
import { VoucherDetailView } from "./voucher-detail-view";
import { buildCachedVoucherDetail, writeVoucherDetailCache } from "./voucher-detail-cache";
import { buildRedemptionInstructions } from "./wallet-redemption-copy";

/** `VoucherDetailView` reads the region and its translations ambiently (YT-0405) — see `burn-error-message.test.tsx` for the same pattern. */
function renderWithRegion(ui: ReactElement, region: Region = "ID") {
  const { locale } = regionDisplayConfig(region);
  const messages = { wallet: region === "AU" ? enAU : idID };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

/**
 * jsdom cannot render a real `<canvas>`, so `qrcode` is mocked the same way
 * as voucher-qr-canvas.test.tsx. These tests are about VoucherDetailView's
 * own behaviour (cache-first hydration, archived-vs-redeemable branching,
 * zero network dependency) — not about `qrcode`'s internals or about
 * `next/dynamic`'s chunk-splitting, which the bundle-size script verifies
 * separately.
 */
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE") },
}));

/** Flushes the mocked qrcode promise (and its resulting state update) so it settles inside `act` instead of after the test ends. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

// mockVouchers is a non-empty fixed-length (15) deterministic array — indices 0 and 1 always exist.
const cachedVoucher: Voucher = {
  ...mockVouchers[0]!,
  status: "active",
  expiresAt: "2026-09-19T10:00:00.000Z",
  merchantName: "Toko Cache",
  title: "Voucher dari cache",
};
const staleServerVoucher: Voucher = {
  ...mockVouchers[1]!,
  status: "active",
  expiresAt: "2026-09-19T10:00:00.000Z",
  merchantName: "Toko Server",
  title: "Voucher dari server",
};

describe("VoucherDetailView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-19T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders from the local cache alone with the network unreachable, and never calls fetch", async () => {
    const cachedInstructions = buildRedemptionInstructions(
      cachedVoucher.merchantName,
      cachedVoucher.partialRedemptionPolicy,
      "id-ID",
    );
    writeVoucherDetailCache(
      buildCachedVoucherDetail(cachedVoucher, cachedInstructions, "2026-09-19T08:00:00.000Z"),
    );

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);

    // initialDetail intentionally names a DIFFERENT voucher than what is
    // cached under this voucherId, so a passing assertion can only mean the
    // component actually read the cache — not that it happened to render
    // the prop it was handed anyway.
    const staleServerInstructions = buildRedemptionInstructions(
      staleServerVoucher.merchantName,
      staleServerVoucher.partialRedemptionPolicy,
      "id-ID",
    );
    const staleServerDetail = buildCachedVoucherDetail(
      staleServerVoucher,
      staleServerInstructions,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(
      <VoucherDetailView voucherId={cachedVoucher.id} initialDetail={staleServerDetail} />,
    );
    await flushMicrotasks();

    expect(screen.getByText(cachedVoucher.merchantName)).toBeInTheDocument();
    expect(screen.getByText(cachedInstructions)).toBeInTheDocument();
    expect(screen.queryByText(staleServerVoucher.merchantName)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a rotating QR and a validity countdown for an active, unexpired voucher", async () => {
    const instructions = buildRedemptionInstructions(
      cachedVoucher.merchantName,
      cachedVoucher.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(
      cachedVoucher,
      instructions,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(<VoucherDetailView voucherId={cachedVoucher.id} initialDetail={detail} />);
    await flushMicrotasks();

    expect(screen.getByText("Aktif")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Waktu sebelum kode QR diperbarui" }),
    ).toBeInTheDocument();
  });

  it("shows an archived panel instead of a QR for an already-redeemed voucher", async () => {
    const redeemed: Voucher = { ...cachedVoucher, status: "redeemed" };
    const instructions = buildRedemptionInstructions(
      redeemed.merchantName,
      redeemed.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(redeemed, instructions, "2026-09-19T09:00:00.000Z");

    renderWithRegion(<VoucherDetailView voucherId={redeemed.id} initialDetail={detail} />);
    await flushMicrotasks();

    expect(screen.getAllByText("Sudah dipakai").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("archives an 'active'-status voucher once its expiry time actually passes, per plain wall-clock time", async () => {
    const almostExpired: Voucher = {
      ...cachedVoucher,
      status: "active",
      expiresAt: "2026-09-19T09:00:05.000Z",
    };
    const instructions = buildRedemptionInstructions(
      almostExpired.merchantName,
      almostExpired.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(
      almostExpired,
      instructions,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(<VoucherDetailView voucherId={almostExpired.id} initialDetail={detail} />);
    await flushMicrotasks();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    for (let tick = 0; tick < 6; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    await flushMicrotasks();

    expect(screen.getAllByText("Kedaluwarsa").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows per-merchant redemption instructions in Indonesian", async () => {
    const instructions = buildRedemptionInstructions(
      cachedVoucher.merchantName,
      cachedVoucher.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(
      cachedVoucher,
      instructions,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(<VoucherDetailView voucherId={cachedVoucher.id} initialDetail={detail} />);
    await flushMicrotasks();

    // Assert the instructions element itself, not a loose /kasir/ match:
    // the page now also renders "Atau sebutkan kode ini ke kasir:" above the
    // plain voucher code, so a substring query matches two elements and says
    // nothing about which one carries the merchant's instructions.
    expect(screen.getByText(instructions)).toBeInTheDocument();
    expect(instructions).toMatch(/kasir/);
  });
});

describe("VoucherDetailView (en-AU, YT-0405)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-19T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the remaining value in AUD and the section labels in English, never a hardcoded Rp", async () => {
    const instructions = buildRedemptionInstructions(
      cachedVoucher.merchantName,
      cachedVoucher.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(
      cachedVoucher,
      instructions,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(
      <VoucherDetailView voucherId={cachedVoucher.id} initialDetail={detail} />,
      "AU",
    );
    await flushMicrotasks();

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Remaining value")).toBeInTheDocument();
    expect(screen.getByText("Valid until")).toBeInTheDocument();
    expect(screen.getByText("How to redeem")).toBeInTheDocument();
    expect(screen.getByText(/^\$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Time until the QR code refreshes" }),
    ).toBeInTheDocument();
  });

  it("shows an archived voucher's status and end date in English", async () => {
    const redeemed: Voucher = { ...cachedVoucher, status: "redeemed" };
    const instructions = buildRedemptionInstructions(
      redeemed.merchantName,
      redeemed.partialRedemptionPolicy,
      "id-ID",
    );
    const detail = buildCachedVoucherDetail(redeemed, instructions, "2026-09-19T09:00:00.000Z");

    renderWithRegion(<VoucherDetailView voucherId={redeemed.id} initialDetail={detail} />, "AU");
    await flushMicrotasks();

    expect(screen.getAllByText("Redeemed").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Ended /)).toBeInTheDocument();
  });
});
