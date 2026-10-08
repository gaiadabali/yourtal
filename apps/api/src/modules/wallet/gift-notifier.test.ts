import { describe, expect, it, vi } from "vitest";
import { ResultAsync, err, ok } from "neverthrow";
import type { VoucherGift } from "@yourtal/contracts/voucher-internal/gifts";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import type { GiftPartyReader } from "./gift-party-reader";
import { GiftNotifier } from "./gift-notifier";

/**
 * 13.3.u. The sweep runs on a timer with nobody awaiting it, so a rejection
 * from the voucher client used to surface as an unhandled rejection. No
 * database: the notifier is built over stubs.
 */
function gift(id: string): VoucherGift {
  return {
    giftId: id,
    voucherId: `voucher-${id}`,
    senderId: `sender-${id}`,
    recipientId: `recipient-${id}`,
    title: "Coffee",
  } as unknown as VoucherGift;
}

function build(sweepGifts: () => unknown) {
  const execute = vi.fn(() => Promise.resolve({ rowCount: 0, rows: [] }));
  const byUserId = vi.fn((_id: string) => Promise.resolve(null));
  const notifier = new GiftNotifier(
    { execute } as unknown as AppDb,
    { byUserId } as unknown as GiftPartyReader,
    { sweepGifts } as unknown as VoucherInternalClient,
  );
  return { notifier, byUserId };
}

describe("GiftNotifier.sweep", () => {
  it("returns 0 and does not throw when the voucher service answers 500", async () => {
    // The HTTP client rejects (not an err Result) for an unmapped status.
    const rejects = (): unknown =>
      new ResultAsync(Promise.reject(new Error("voucher /internal/v1/gifts/sweep answered 500")));
    const { notifier } = build(rejects);

    await expect(notifier.sweep()).resolves.toBe(0);
  });

  it("returns 0 when the call throws synchronously", async () => {
    const { notifier } = build(() => {
      throw new Error("socket hang up");
    });
    await expect(notifier.sweep()).resolves.toBe(0);
  });

  it("returns 0 on a refusal result", async () => {
    const { notifier } = build(() => new ResultAsync(Promise.resolve(err({ code: "not_found" }))));
    await expect(notifier.sweep()).resolves.toBe(0);
  });

  it("carries on with the other gifts when one return notice throws, and the next sweep runs", async () => {
    const gifts = [gift("a"), gift("b"), gift("c")];
    const { notifier } = build(() => new ResultAsync(Promise.resolve(ok({ gifts }))));
    const returned = vi
      .spyOn(notifier, "returned")
      .mockImplementation((g) =>
        g.giftId === "b" ? Promise.reject(new Error("boom")) : Promise.resolve(),
      );

    await expect(notifier.sweep()).resolves.toBe(3);
    expect(returned.mock.calls.map(([g]) => g.giftId)).toEqual(["a", "b", "c"]);
    await expect(notifier.sweep()).resolves.toBe(3);
  });

  it("notifies the sender of every swept gift", async () => {
    const gifts = [gift("a"), gift("b")];
    const { notifier, byUserId } = build(() => new ResultAsync(Promise.resolve(ok({ gifts }))));

    await expect(notifier.sweep()).resolves.toBe(2);
    expect(byUserId.mock.calls.map(([id]) => id)).toEqual(["sender-a", "sender-b"]);
  });
});
