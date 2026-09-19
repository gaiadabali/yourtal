import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Voucher } from "@yourtal/contracts/voucher";
import { mockVouchers } from "@yourtal/contracts/voucher/mock";
import { VoucherDetailView } from "./voucher-detail-view";
import { buildCachedVoucherDetail, writeVoucherDetailCache } from "./voucher-detail-cache";
import { buildRedemptionInstructions } from "./wallet-redemption-copy";

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
    const cachedInstructions = buildRedemptionInstructions(cachedVoucher.merchantName, cachedVoucher.partialRedemptionPolicy);
    writeVoucherDetailCache(buildCachedVoucherDetail(cachedVoucher, cachedInstructions, "2026-09-19T08:00:00.000Z"));

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);

    // initialDetail intentionally names a DIFFERENT voucher than what is
    // cached under this voucherId, so a passing assertion can only mean the
    // component actually read the cache — not that it happened to render
    // the prop it was handed anyway.
    const staleServerInstructions = buildRedemptionInstructions(
      staleServerVoucher.merchantName,
      staleServerVoucher.partialRedemptionPolicy,
    );
    const staleServerDetail = buildCachedVoucherDetail(staleServerVoucher, staleServerInstructions, "2026-09-19T09:00:00.000Z");

    render(<VoucherDetailView voucherId={cachedVoucher.id} initialDetail={staleServerDetail} />);
    await flushMicrotasks();

    expect(screen.getByText(cachedVoucher.merchantName)).toBeInTheDocument();
    expect(screen.getByText(cachedInstructions)).toBeInTheDocument();
    expect(screen.queryByText(staleServerVoucher.merchantName)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a rotating QR and a validity countdown for an active, unexpired voucher", async () => {
    const instructions = buildRedemptionInstructions(cachedVoucher.merchantName, cachedVoucher.partialRedemptionPolicy);
    const detail = buildCachedVoucherDetail(cachedVoucher, instructions, "2026-09-19T09:00:00.000Z");

    render(<VoucherDetailView voucherId={cachedVoucher.id} initialDetail={detail} />);
    await flushMicrotasks();

    expect(screen.getByText("Aktif")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Waktu sebelum kode QR diperbarui" })).toBeInTheDocument();
  });

  it("shows an archived panel instead of a QR for an already-redeemed voucher", async () => {
    const redeemed: Voucher = { ...cachedVoucher, status: "redeemed" };
    const instructions = buildRedemptionInstructions(redeemed.merchantName, redeemed.partialRedemptionPolicy);
    const detail = buildCachedVoucherDetail(redeemed, instructions, "2026-09-19T09:00:00.000Z");

    render(<VoucherDetailView voucherId={redeemed.id} initialDetail={detail} />);
    await flushMicrotasks();

    expect(screen.getAllByText("Sudah dipakai").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("archives an 'active'-status voucher once its expiry time actually passes, per plain wall-clock time", async () => {
    const almostExpired: Voucher = { ...cachedVoucher, status: "active", expiresAt: "2026-09-19T09:00:05.000Z" };
    const instructions = buildRedemptionInstructions(almostExpired.merchantName, almostExpired.partialRedemptionPolicy);
    const detail = buildCachedVoucherDetail(almostExpired, instructions, "2026-09-19T09:00:00.000Z");

    render(<VoucherDetailView voucherId={almostExpired.id} initialDetail={detail} />);
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
    const instructions = buildRedemptionInstructions(cachedVoucher.merchantName, cachedVoucher.partialRedemptionPolicy);
    const detail = buildCachedVoucherDetail(cachedVoucher, instructions, "2026-09-19T09:00:00.000Z");

    render(<VoucherDetailView voucherId={cachedVoucher.id} initialDetail={detail} />);
    await flushMicrotasks();

    expect(screen.getByText(/kasir/)).toBeInTheDocument();
    expect(screen.getByText(instructions)).toBeInTheDocument();
  });
});
