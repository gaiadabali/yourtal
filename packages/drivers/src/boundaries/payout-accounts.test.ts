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
});
