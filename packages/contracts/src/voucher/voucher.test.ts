import { describe, expect, it } from "vitest";
import { voucherSchema } from "./voucher";
import { expiredVoucherFixture, expiringWithinHourVoucherFixture, generateVoucher, generateVouchers, mockVouchers } from "./voucher.mock";

const validVoucher = {
  id: "11111111-1111-4111-8111-111111111111",
  listingId: "22222222-2222-4222-8222-222222222222",
  ownerId: "33333333-3333-4333-8333-333333333333",
  code: "ABC12345",
  merchantName: "Kopi Kenangan",
  title: "Voucher Kopi Kenangan",
  faceValueIdr: 30_000,
  remainingValueIdr: 30_000,
  partialRedemptionPolicy: "single_use_forfeit",
  transferable: false,
  status: "active",
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
};

describe("voucherSchema", () => {
  it("round-trips a valid voucher", () => {
    const parsed = voucherSchema.parse(validVoucher);
    expect(parsed).toMatchObject({ code: "ABC12345", status: "active" });
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "negative remaining value", overrides: { remainingValueIdr: -1 } },
    { name: "remainingValue greater than faceValue", overrides: { remainingValueIdr: 40_000, faceValueIdr: 30_000 } },
    { name: "invalid status enum value", overrides: { status: "burned" } },
    { name: "invalid partial redemption policy enum value", overrides: { partialRedemptionPolicy: "instant_refund" } },
    { name: "code too short", overrides: { code: "AB" } },
    { name: "expiresAt before issuedAt", overrides: { issuedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z" } },
    { name: "non-uuid listingId", overrides: { listingId: "not-a-uuid" } },
    { name: "non-uuid ownerId", overrides: { ownerId: "not-a-uuid" } },
    { name: "non-datetime issuedAt", overrides: { issuedAt: "a while ago" } },
    { name: "missing merchantName", overrides: { merchantName: "" } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validVoucher, ...overrides };
    expect(voucherSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateVoucher determinism", () => {
  it("produces byte-identical output for the same seed and reference instant", () => {
    const now = new Date("2026-09-19T09:00:00.000Z");
    const first = generateVoucher({ seed: 9, now });
    const second = generateVoucher({ seed: 9, now });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateVouchers(15, 3_000)).toStrictEqual(mockVouchers);
  });
});

describe("awkward fixtures", () => {
  it("the expired voucher fixture's expiry is before the fixed reference instant", () => {
    const referenceInstant = new Date("2026-09-19T09:00:00.000Z");
    expect(new Date(expiredVoucherFixture.expiresAt).getTime()).toBeLessThan(referenceInstant.getTime());
    expect(expiredVoucherFixture.status).toBe("expired");
  });

  it("the expiring-within-the-hour voucher fixture expires within 60 minutes of the reference instant", () => {
    const referenceInstant = new Date("2026-09-19T09:00:00.000Z");
    const minutesUntilExpiry = (new Date(expiringWithinHourVoucherFixture.expiresAt).getTime() - referenceInstant.getTime()) / (1_000 * 60);
    expect(minutesUntilExpiry).toBeGreaterThan(0);
    expect(minutesUntilExpiry).toBeLessThanOrEqual(60);
  });
});
