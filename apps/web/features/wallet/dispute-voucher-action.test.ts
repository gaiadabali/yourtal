import { describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: apiFetchMock }));

describe("disputeVoucherAction", () => {
  it("posts the closed-list reason with a fresh idempotency key, to the exact 4.7.c route", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      data: { voucherId: "voucher-1", outcome: "reinstated", points: 500 },
    });
    const { disputeVoucherAction } = await import("./dispute-voucher-action");

    const result = await disputeVoucherAction("voucher-1", "not_honoured");

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/wallet/vouchers/voucher-1/dispute");
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({ reason: "not_honoured" });
    expect(typeof init.headers["idempotency-key"]).toBe("string");
    expect(init.headers["idempotency-key"].length).toBeGreaterThan(0);
    expect(result).toEqual({
      ok: true,
      result: { voucherId: "voucher-1", outcome: "reinstated", points: 500 },
    });
  });

  it("uses a different idempotency key on a second, separate submission", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      data: { voucherId: "voucher-1", outcome: "queued", points: 0 },
    });
    const { disputeVoucherAction } = await import("./dispute-voucher-action");

    await disputeVoucherAction("voucher-1", "merchant_closed");
    await disputeVoucherAction("voucher-1", "merchant_closed");

    const firstKey = apiFetchMock.mock.calls[0]![2].headers["idempotency-key"];
    const secondKey = apiFetchMock.mock.calls[1]![2].headers["idempotency-key"];
    expect(firstKey).not.toBe(secondKey);
  });

  it("surfaces a failed call as a plain error result instead of throwing", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "already_granted", message: "already redeemed" },
    });
    const { disputeVoucherAction } = await import("./dispute-voucher-action");

    const result = await disputeVoucherAction("voucher-1", "other");

    expect(result).toEqual({
      ok: false,
      error: { kind: "http", status: 409, code: "already_granted", message: "already redeemed" },
    });
  });
});
