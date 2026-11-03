import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Region } from "@yourtal/contracts/region";
import { RegionProvider } from "@/features/region/region-context";
import { regionDisplayConfig } from "@/features/region/region-config";
import enAU from "@/messages/en-AU/wallet.json";
import idID from "@/messages/id-ID/wallet.json";
import enAuction from "@/messages/en-AU/auction.json";
import idAuction from "@/messages/id-ID/auction.json";
import enCharity from "@/messages/en-AU/charity.json";
import idCharity from "@/messages/id-ID/charity.json";
import { VoucherDetailView } from "./voucher-detail-view";
import { revealVoucherCodeAction } from "./reveal-voucher-code-action";
import type { VoucherDetailSource } from "./voucher-detail-cache";
import { buildCachedVoucherDetail, writeVoucherDetailCache } from "./voucher-detail-cache";
import type { WalletQrDetail } from "./wallet-data";

/** `VoucherDetailView` reads the region and its translations ambiently — see `burn-error-message.test.tsx` for the same pattern. */
function renderWithRegion(ui: ReactElement, region: Region = "ID") {
  const { locale } = regionDisplayConfig(region);
  const au = region === "AU";
  const messages = {
    wallet: au ? enAU : idID,
    auction: au ? enAuction : idAuction,
    charity: au ? enCharity : idCharity,
  };
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
 * zero network dependency) — not about `qrcode`'s internals.
 */
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE") },
}));

vi.mock("./refresh-voucher-qr-action", () => ({
  refreshVoucherQrAction: vi.fn().mockResolvedValue({ ok: false }),
}));
// The real component code-splits the canvas behind next/dynamic, which never settles under fake timers.
vi.mock("./voucher-qr-code", () => ({
  VoucherQrCode: ({ code, caption }: { code: string; caption?: string }) => (
    <div>
      <span>{code}</span>
      {caption ? <span>{caption}</span> : null}
    </div>
  ),
}));
vi.mock("./reveal-voucher-code-action", () => ({
  revealVoucherCodeAction: vi.fn().mockResolvedValue({ ok: false }),
}));
vi.mock("./dispute-voucher-action", () => ({
  disputeVoucherAction: vi.fn(),
}));
// The Gift and List for charity dialogs route and call server actions only when used.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./gift-actions", () => ({ giftVoucherAction: vi.fn() }));
vi.mock("@/features/auction/auction-actions", () => ({ listVoucherAction: vi.fn() }));

/** Flushes pending microtasks (the mocked qrcode promise, cache reads) so they settle inside `act`. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const cachedVoucher: VoucherDetailSource = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000010",
  state: "activated",
  status: "active",
  merchantName: "Toko Cache",
  title: "Voucher dari cache",
  currency: "IDR",
  faceValueMinor: 50_000,
  remainingValueMinor: 50_000,
  partialRedemptionPolicy: "balance_carrying",
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-09-19T10:00:00.000Z",
  location: { name: "Toko Cache CBD", address: "Jl. Utama 1", district: "CBD" },
};
const staleServerVoucher: VoucherDetailSource = {
  ...cachedVoucher,
  voucherId: "00000000-0000-4000-8000-000000000002",
  merchantName: "Toko Server",
  title: "Voucher dari server",
};
const sampleQr: WalletQrDetail = {
  voucherId: cachedVoucher.voucherId,
  token: "signed-token-0",
  expiresAt: "2026-09-19T09:05:00.000Z",
  tokens: [{ token: "signed-token-0", expiresAt: "2026-09-19T09:05:00.000Z" }],
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
    writeVoucherDetailCache(buildCachedVoucherDetail(cachedVoucher, "2026-09-19T08:00:00.000Z"));

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);

    // initialDetail intentionally names a DIFFERENT voucher than what is
    // cached under this voucherId, so a passing assertion can only mean the
    // component actually read the cache — not that it happened to render
    // the prop it was handed anyway.
    const staleServerDetail = buildCachedVoucherDetail(
      staleServerVoucher,
      "2026-09-19T09:00:00.000Z",
    );

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={staleServerDetail}
        initialQr={sampleQr}
      />,
    );
    await flushMicrotasks();

    expect(screen.getByText(cachedVoucher.merchantName!)).toBeInTheDocument();
    expect(screen.queryByText(staleServerVoucher.merchantName!)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a rotating QR, a validity countdown and the dispute action for a held, unexpired voucher", async () => {
    const detail = buildCachedVoucherDetail(cachedVoucher, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );
    await flushMicrotasks();

    expect(screen.getByText("Aktif")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Waktu sebelum kode QR diperbarui" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Voucher ini tidak bisa dipakai")).toBeInTheDocument();
  });

  it("shows the redemption code once it is fetched, and never writes it to browser storage", async () => {
    vi.mocked(revealVoucherCodeAction).mockResolvedValueOnce({ ok: true, code: "K7M2-Q9XP" });
    const detail = buildCachedVoucherDetail(cachedVoucher, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );

    await flushMicrotasks();

    expect(screen.getByText("K7M2-Q9XP")).toBeInTheDocument();
    const stored = Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key));
    expect(JSON.stringify(stored)).not.toContain("K7M2-Q9XP");
  });

  it("falls back to the QR alone, with the offline caption, when no code can be fetched", async () => {
    const detail = buildCachedVoucherDetail(cachedVoucher, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );
    await flushMicrotasks();

    expect(
      screen.getByText("Kode tidak tersedia saat offline — pindai kode QR saja."),
    ).toBeInTheDocument();
  });

  it("shows an archived panel instead of a QR for a released voucher, with no dispute action", async () => {
    const released: VoucherDetailSource = {
      ...cachedVoucher,
      state: "released",
      status: undefined,
    };
    const detail = buildCachedVoucherDetail(released, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView voucherId={released.voucherId} initialDetail={detail} initialQr={null} />,
    );
    await flushMicrotasks();

    expect(screen.getAllByText("Dilepas").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Voucher ini tidak bisa dipakai")).not.toBeInTheDocument();
  });

  it("shows a voided voucher as no longer valid, without any spending details", async () => {
    // A dispute (or fraud/admin) void has no public status (11.6.e).
    const voided: VoucherDetailSource = { ...cachedVoucher, status: undefined };
    const detail = buildCachedVoucherDetail(voided, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView voucherId={voided.voucherId} initialDetail={detail} initialQr={null} />,
    );
    await flushMicrotasks();

    expect(screen.getAllByText("Tidak berlaku lagi").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Voucher ini dibatalkan, jadi tidak bisa dipakai di kasir."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Berakhir/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Rp/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("archives a held voucher once its expiry time actually passes, per plain wall-clock time", async () => {
    const almostExpired: VoucherDetailSource = {
      ...cachedVoucher,
      expiresAt: "2026-09-19T09:00:05.000Z",
    };
    const detail = buildCachedVoucherDetail(almostExpired, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={almostExpired.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );
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

  it("shows a generic instructions fallback when the merchant/policy display fields are not live yet", async () => {
    const bare: VoucherDetailSource = {
      voucherId: cachedVoucher.voucherId,
      listingId: cachedVoucher.listingId,
      state: "activated",
      status: "active",
    };
    const detail = buildCachedVoucherDetail(bare, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView voucherId={bare.voucherId} initialDetail={detail} initialQr={sampleQr} />,
    );
    await flushMicrotasks();

    expect(
      screen.getByText(
        "Tunjukkan kode QR ini ke kasir saat membayar, atau sebutkan kode vouchernya kalau diminta secara manual.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Voucher")).toBeInTheDocument();
  });

  it("shows an offline notice when the browser reports itself offline", async () => {
    const onLineSpy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const detail = buildCachedVoucherDetail(cachedVoucher, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );
    await flushMicrotasks();

    expect(
      screen.getByText(
        "Kamu sedang offline — menampilkan salinan voucher yang tersimpan terakhir.",
      ),
    ).toBeInTheDocument();
    onLineSpy.mockRestore();
  });
});

describe("VoucherDetailView — which branch honours it", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("names the outlet, not just the merchant, and does so from cache with the network unreachable", async () => {
    const detail = buildCachedVoucherDetail(cachedVoucher, "2026-09-19T08:00:00.000Z");
    writeVoucherDetailCache(detail);

    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);

    renderWithRegion(
      <VoucherDetailView
        voucherId={cachedVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
    );
    await flushMicrotasks();

    expect(screen.getByText(cachedVoucher.location!.name)).toBeInTheDocument();
    expect(screen.getByText(cachedVoucher.location!.address)).toBeInTheDocument();
    expect(screen.getByText(cachedVoucher.location!.district)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("VoucherDetailView (en-AU)", () => {
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
    // The voucher's own currency (YT-0513), never the viewer's region.
    const auVoucher: VoucherDetailSource = { ...cachedVoucher, currency: "AUD" };
    const detail = buildCachedVoucherDetail(auVoucher, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView
        voucherId={auVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
      />,
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

  it("shows a released voucher's status in English", async () => {
    const released: VoucherDetailSource = {
      ...cachedVoucher,
      state: "released",
      status: undefined,
    };
    const detail = buildCachedVoucherDetail(released, "2026-09-19T09:00:00.000Z");

    renderWithRegion(
      <VoucherDetailView voucherId={released.voucherId} initialDetail={detail} initialQr={null} />,
      "AU",
    );
    await flushMicrotasks();

    expect(screen.getAllByText("Released").length).toBeGreaterThan(0);
  });
});

describe("VoucherDetailView: why a voucher cannot be passed on", () => {
  const auVoucher: VoucherDetailSource = {
    ...cachedVoucher,
    currency: "AUD",
    expiresAt: "2027-10-01T00:00:00.000Z",
  };

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-19T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function show(extra: Partial<React.ComponentProps<typeof VoucherDetailView>>) {
    const detail = buildCachedVoucherDetail(auVoucher, "2026-09-19T09:00:00.000Z");
    renderWithRegion(
      <VoucherDetailView
        voucherId={auVoucher.voucherId}
        initialDetail={detail}
        initialQr={sampleQr}
        {...extra}
      />,
      "AU",
    );
    await flushMicrotasks();
  }

  it("says a voucher won at an auction cannot be passed on again, instead of showing nothing", async () => {
    await show({ passNotice: "received_as_gift" });

    expect(screen.getByText(/can't be passed on again/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gift" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List for charity" })).not.toBeInTheDocument();
  });

  it("offers Gift and List for charity, and no reason, when the voucher qualifies", async () => {
    await show({ giftable: true, charities: [] });

    expect(screen.getByRole("button", { name: "Gift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List for charity" })).toBeInTheDocument();
    expect(screen.queryByText(/can't be gifted or listed/)).not.toBeInTheDocument();
  });

  it("keeps Gift but explains the missing listing when the voucher is too close to expiry", async () => {
    await show({ giftable: true, passNotice: "expires_soon" });

    expect(screen.getByRole("button", { name: "Gift" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "List for charity" })).not.toBeInTheDocument();
    expect(screen.getByText(/needs at least 4 days left/)).toBeInTheDocument();
  });

  it("explains a transferred voucher once, with the gift's date, and does not repeat the status", async () => {
    const transferred: VoucherDetailSource = { ...auVoucher, status: "transferred" };
    const detail = buildCachedVoucherDetail(transferred, "2026-09-19T09:00:00.000Z");
    renderWithRegion(
      <VoucherDetailView
        voucherId={transferred.voucherId}
        initialDetail={detail}
        initialQr={null}
        passedOn={{
          status: "accepted",
          sentAt: "2026-10-02T01:40:22.770Z",
          acceptBy: "2026-10-09T01:40:22.783Z",
        }}
      />,
      "AU",
    );
    await flushMicrotasks();

    expect(screen.getAllByText("Transferred")).toHaveLength(1);
    expect(screen.getByText(/You gave this voucher as a gift on 2 Oct 2026/)).toBeInTheDocument();
  });

  it("explains a transferred voucher in general words when no gift is known", async () => {
    const transferred: VoucherDetailSource = { ...auVoucher, status: "transferred" };
    const detail = buildCachedVoucherDetail(transferred, "2026-09-19T09:00:00.000Z");
    renderWithRegion(
      <VoucherDetailView
        voucherId={transferred.voucherId}
        initialDetail={detail}
        initialQr={null}
      />,
      "AU",
    );
    await flushMicrotasks();

    expect(screen.getAllByText("Transferred")).toHaveLength(1);
    expect(screen.getByText(/gifted or listed for a charity auction/)).toBeInTheDocument();
  });
});
