import { describe, expect, it } from "vitest";
import { SIMULATED_BANK_LAST4, createSimulatedPayoutAccounts } from "./payout-accounts";

describe("simulated payout accounts", () => {
  const accounts = () =>
    createSimulatedPayoutAccounts(undefined, {
      declaredMinorUnitExponent: { AUD: 2, IDR: 0 },
      nowMs: () => 1_800_000_000_000,
    });

  it("creates a stable, already onboarded account", async () => {
    const driver = accounts();
    const request = {
      idempotencyKey: "acct:b1",
      reference: "business:b1",
      kind: "business" as const,
      payoutSchedule: "manual" as const,
    };
    const created = (await driver.createAccount(request))._unsafeUnwrap();
    expect((await driver.createAccount(request))._unsafeUnwrap()).toStrictEqual(created);
    expect((await driver.getAccount(created.accountRef))._unsafeUnwrap()).toStrictEqual({
      accountRef: created.accountRef,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      bankLast4: SIMULATED_BANK_LAST4,
    });
    // A fresh driver (a restart) still knows it.
    expect((await accounts().getAccount(created.accountRef)).isOk()).toBe(true);
  });

  it("sends the link straight back, with a 30-minute expiry", async () => {
    const link = await accounts().onboardingLink({
      accountRef: "simacct_1",
      returnUrl: "https://app.test/done",
      refreshUrl: "r",
      purpose: "onboarding",
    });
    expect(link._unsafeUnwrap()).toStrictEqual({
      url: "https://app.test/done",
      expiresAt: new Date(1_800_001_800_000),
    });
  });

  it.each([
    { currency: "AUD" as const, amountMinor: 9_900 },
    { currency: "IDR" as const, amountMinor: 450_000 },
  ])("transfers and pays out $currency in our stored unit", async ({ currency, amountMinor }) => {
    const driver = accounts();
    const request = {
      idempotencyKey: `s:${currency}`,
      amountMinor,
      currency,
      accountRef: "simacct_1",
      reference: "statement:1",
    };
    const transfer = (await driver.transfer(request))._unsafeUnwrap();
    expect(driver.sent(transfer.transferRef)).toBe(amountMinor);
    const payout = (await driver.payout(request))._unsafeUnwrap();
    expect(payout.status).toBe("paid");
    expect(driver.sent(payout.payoutRef)).toBe(amountMinor);
  });

  it("refuses an undeclared IDR unit, an unknown account, and a faulted call", async () => {
    const bare = createSimulatedPayoutAccounts();
    const move = {
      idempotencyKey: "k",
      amountMinor: 100,
      currency: "IDR" as const,
      accountRef: "simacct_1",
      reference: "r",
    };
    expect((await bare.transfer(move))._unsafeUnwrapErr().kind).toBe("declined");
    expect(
      (await accounts().payout({ ...move, accountRef: "acct_real" }))._unsafeUnwrapErr().kind,
    ).toBe("declined");
    expect((await accounts().getAccount("acct_real")).isErr()).toBe(true);
    const timingOut = createSimulatedPayoutAccounts({ kind: "timeout" });
    expect(
      (await timingOut.transfer({ ...move, currency: "AUD" }))._unsafeUnwrapErr(),
    ).toMatchObject({
      kind: "timeout",
      mayHaveSucceeded: true,
    });
  });

  describe("read-back", () => {
    const move = {
      idempotencyKey: "disb:1",
      amountMinor: 4_500,
      currency: "AUD" as const,
      accountRef: "simacct_1",
      reference: "disbursement:1",
    };
    const since = new Date(0);

    it("reads back what it moved, by ref and by the reference it was sent", async () => {
      const driver = accounts();
      const transfer = (await driver.transfer(move))._unsafeUnwrap();
      const payout = (
        await driver.payout({ ...move, reference: "disbursement:1:1" })
      )._unsafeUnwrap();
      const details = {
        payoutRef: payout.payoutRef,
        status: "paid",
        amountMinor: 4_500,
        currency: "AUD",
        reference: "disbursement:1:1",
        failureCode: null,
      };
      expect((await driver.getPayout("simacct_1", payout.payoutRef))._unsafeUnwrap()).toStrictEqual(
        details,
      );
      const foundPayout = await driver.findPayout({
        accountRef: "simacct_1",
        reference: "disbursement:1:1",
        since,
      });
      expect(foundPayout._unsafeUnwrap()).toStrictEqual(details);
      const foundTransfer = await driver.findTransfer({
        accountRef: "simacct_1",
        reference: "disbursement:1",
        since,
      });
      expect(foundTransfer._unsafeUnwrap()).toStrictEqual({
        transferRef: transfer.transferRef,
        amountMinor: 4_500,
        currency: "AUD",
        reference: "disbursement:1",
      });
    });

    it("says nothing was found as null, and refuses an unknown payout or account", async () => {
      const driver = accounts();
      (await driver.payout(move))._unsafeUnwrap();
      const find = { accountRef: "simacct_1", reference: "disbursement:9", since };
      expect((await driver.findPayout(find))._unsafeUnwrap()).toBeNull();
      expect((await driver.findTransfer(find))._unsafeUnwrap()).toBeNull();
      // A reference is not a ref.
      const byReference = await driver.getPayout("simacct_1", "disbursement:1");
      expect(byReference._unsafeUnwrapErr()).toMatchObject({
        kind: "declined",
        mayHaveSucceeded: false,
      });
      expect((await driver.getPayout("simacct_1", "simpo_nope"))._unsafeUnwrapErr().kind).toBe(
        "declined",
      );
      expect((await driver.getPayout("acct_real", "simpo_x"))._unsafeUnwrapErr().kind).toBe(
        "declined",
      );
      expect((await driver.findPayout({ ...find, accountRef: "acct_real" })).isErr()).toBe(true);
      expect((await driver.findTransfer({ ...find, accountRef: "acct_real" })).isErr()).toBe(true);
    });

    it("returns the fault for a faulted read-back", async () => {
      const driver = createSimulatedPayoutAccounts({ kind: "timeout" });
      const find = { accountRef: "simacct_1", reference: "r", since };
      for (const failed of [
        await driver.getPayout("simacct_1", "simpo_x"),
        await driver.findPayout(find),
        await driver.findTransfer(find),
      ]) {
        expect(failed._unsafeUnwrapErr()).toMatchObject({
          kind: "timeout",
          mayHaveSucceeded: true,
        });
      }
    });
  });
});
