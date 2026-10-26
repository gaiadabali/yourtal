import { describe, expect, it } from "vitest";
import type { WalletGift } from "@yourtal/contracts/wallet/wallet-gift";
import { passedOnBy } from "./voucher-passed-on";

const VOUCHER = "6ed144c0-a181-4690-a7da-918cf18e34fa";
const gift = (over: Partial<WalletGift>): WalletGift => ({
  giftId: "d7461e1e-4e2f-4213-bc44-1ddcd5d95784",
  direction: "sent",
  status: "accepted",
  senderDisplayName: null,
  voucherId: VOUCHER,
  title: "A free coffee",
  merchantName: "Harbour Grind Café",
  currency: "AUD",
  faceValueMinor: 600 as WalletGift["faceValueMinor"],
  voucherExpiresAt: "2027-10-01T05:36:25.775Z",
  createdAt: "2026-10-02T01:40:22.770Z",
  acceptBy: "2026-10-09T01:40:22.783Z",
  resolvedAt: null,
  ...over,
});

describe("passedOnBy", () => {
  it("finds the gift that gave this voucher away", () => {
    expect(passedOnBy(VOUCHER, [gift({})])).toEqual({
      status: "accepted",
      sentAt: "2026-10-02T01:40:22.770Z",
      acceptBy: "2026-10-09T01:40:22.783Z",
    });
    expect(passedOnBy(VOUCHER, [gift({ status: "pending" })])?.status).toBe("pending");
  });

  it("knows nothing of another voucher, a received gift or one that came back", () => {
    expect(
      passedOnBy(VOUCHER, [gift({ voucherId: "00000000-0000-4000-8000-000000000001" })]),
    ).toBeNull();
    expect(passedOnBy(VOUCHER, [gift({ direction: "received" })])).toBeNull();
    expect(passedOnBy(VOUCHER, [gift({ status: "returned" })])).toBeNull();
    expect(passedOnBy(VOUCHER, [])).toBeNull();
  });
});
