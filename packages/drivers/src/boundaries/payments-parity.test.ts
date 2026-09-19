import { describe, expect, it } from "vitest";
import { MINOR_UNIT, minorUnitExponent } from "@yourtal/contracts/money/minor-unit";
import { CURRENCY_CODES } from "@yourtal/contracts/money/currency";
import { createSimulatedPayments } from "./payments";
import { createSimulatedDisbursement } from "./disbursement";
import { fromProviderAmount, toProviderAmount } from "./provider-amount";

/**
 * The parity suite. YT-0537.
 *
 * ## What it compares, and why not the obvious thing
 *
 * The obvious test is "the driver's declared exponent equals `MINOR_UNIT`'s".
 * That would be **wrong**: a processor legitimately wanting whole Rupiah is
 * not a bug, it is the case this whole design exists to support. Asserting
 * equality would forbid the thing we built.
 *
 * What must hold is that **the same real-world amount comes out the other
 * side**. Rp 45.000 is 4_500_000 stored sen and 45_000 provider Rupiah, and
 * both denote Rp 45.000. That property catches a 100x error whichever
 * direction the mistake runs, and it permits a processor that differs.
 *
 * ## Neither side derives from the other
 *
 * `MINOR_UNIT` says what we store. The driver says what it speaks. If the
 * driver read its exponent from `MINOR_UNIT` these tests would be comparing
 * a value to itself — which is exactly what `openapi:go:check` was doing
 * when it compared the generator's output to the generator's output, and
 * exactly why nobody noticed the Go module had never compiled.
 */

const RP_45_000_IN_SEN = 4_500_000;

describe("the platform's own declaration", () => {
  it("still stores IDR in sen and AUD in cents", () => {
    // If this moves, every expectation below is about a different world.
    // Failing here first is more useful than failing in the conversions.
    expect(minorUnitExponent("IDR")).toBe(2);
    expect(minorUnitExponent("AUD")).toBe(2);
    expect(MINOR_UNIT.IDR.status).toBe("confirmed");
  });
});

describe("a driver that speaks the same unit we store", () => {
  const driver = createSimulatedPayments();

  it("sends the stored integer unchanged", async () => {
    const charge = await driver.charge({
      idempotencyKey: "same-unit",
      amountMinor: RP_45_000_IN_SEN,
      currency: "IDR",
      reference: "top-up-1",
    });

    const received = driver.received(charge._unsafeUnwrap().providerReference);
    expect(received?.amount).toBe(RP_45_000_IN_SEN);
  });

  it("declares an exponent for every currency the platform knows", () => {
    // A currency the platform prices in but the driver has not declared is a
    // settlement waiting to be made in a unit nobody chose.
    for (const currency of CURRENCY_CODES) {
      expect(driver.declaredMinorUnitExponent[currency]).toBeTypeOf("number");
    }
  });
});

describe("a driver that speaks whole Rupiah while we store sen", () => {
  // The case the design exists for, not a failure. Xendit may well be this.
  const driver = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: { IDR: 0 },
  });

  it("converts down, so the same money arrives", async () => {
    const charge = await driver.charge({
      idempotencyKey: "rupiah-driver",
      amountMinor: RP_45_000_IN_SEN,
      currency: "IDR",
      reference: "top-up-2",
    });

    const received = driver.received(charge._unsafeUnwrap().providerReference);
    expect(received?.amount).toBe(45_000);

    // The parity property, stated directly: what the provider got means the
    // same money as what we hold.
    const backToStored = fromProviderAmount(received?.amount ?? -1, "IDR", 0);
    expect(backToStored._unsafeUnwrap()).toBe(RP_45_000_IN_SEN);
  });

  it("refuses an amount it cannot send without losing money", async () => {
    // Rp 45.000,50 has no representation in whole Rupiah. Rounding would
    // discard 50 sen per transaction — invisible per item, material per
    // million — so the driver declines rather than deciding for the caller.
    const charge = await driver.charge({
      idempotencyKey: "inexact",
      amountMinor: RP_45_000_IN_SEN + 50,
      currency: "IDR",
      reference: "top-up-3",
    });

    expect(charge.isErr()).toBe(true);
    expect(charge._unsafeUnwrapErr().detail).toContain("discard");
    expect(charge._unsafeUnwrapErr().mayHaveSucceeded).toBe(false);
  });
});

describe("a driver whose declaration does not match what it sends", () => {
  /**
   * The test that gives this suite its point.
   *
   * This driver **claims** whole Rupiah and **sends** the raw stored sen —
   * the 100x error in its natural habitat. Nothing throws, every type
   * checks, and a merchant is settled a hundred times what they should be.
   *
   * Without constructing this case the suite could only ever prove the
   * correct one, which says nothing about whether it would catch the wrong
   * one. A guard that has never been seen to fail has not been shown to work.
   */
  const misdeclared = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: { IDR: 0 },
    convertAmounts: false,
  });

  it("is caught by the parity check", async () => {
    const charge = await misdeclared.charge({
      idempotencyKey: "misdeclared",
      amountMinor: RP_45_000_IN_SEN,
      currency: "IDR",
      reference: "top-up-4",
    });

    const received = misdeclared.received(charge._unsafeUnwrap().providerReference);
    expect(received?.amount).toBe(RP_45_000_IN_SEN); // it sent sen

    // Read back through the unit it CLAIMS, the amount is 4.5 billion
    // Rupiah rather than 45 thousand — off by exactly 100x.
    const asDeclared = fromProviderAmount(
      received?.amount ?? -1,
      "IDR",
      misdeclared.declaredMinorUnitExponent.IDR,
    );
    expect(asDeclared._unsafeUnwrap()).toBe(RP_45_000_IN_SEN * 100);
    expect(asDeclared._unsafeUnwrap()).not.toBe(RP_45_000_IN_SEN);
  });

  it("fails the round-trip property every honest driver satisfies", async () => {
    // Stated as the general property rather than a specific number, because
    // this is the assertion a real parity suite runs against a live vendor.
    const charge = await misdeclared.charge({
      idempotencyKey: "misdeclared-2",
      amountMinor: RP_45_000_IN_SEN,
      currency: "IDR",
      reference: "top-up-5",
    });
    const received = misdeclared.received(charge._unsafeUnwrap().providerReference);

    const roundTripped = fromProviderAmount(
      received?.amount ?? -1,
      "IDR",
      misdeclared.declaredMinorUnitExponent.IDR,
    );
    expect(roundTripped._unsafeUnwrap()).not.toBe(RP_45_000_IN_SEN);
  });
});

describe("the round trip holds for every currency and every plausible processor unit", () => {
  const exponents = [0, 2, 3];

  it.each(
    CURRENCY_CODES.flatMap((currency) => exponents.map((exponent) => ({ currency, exponent }))),
  )("$currency at processor exponent $exponent", ({ currency, exponent }) => {
    // A whole major unit, so the conversion is exact at every exponent
    // tested — the inexact case has its own test above.
    const stored = 1_000 * 10 ** minorUnitExponent(currency);

    const sent = toProviderAmount(stored, currency, exponent);
    expect(sent.isOk(), `${currency} at exponent ${String(exponent)} should convert`).toBe(true);

    const back = fromProviderAmount(sent._unsafeUnwrap(), currency, exponent);
    expect(back._unsafeUnwrap()).toBe(stored);
  });
});

describe("disbursement converts the same way, in the direction that hides", () => {
  it("pays a Rupiah-speaking processor the right money", async () => {
    const driver = createSimulatedDisbursement(undefined, {
      declaredMinorUnitExponent: { IDR: 0 },
    });
    const payout = await driver.payout({
      idempotencyKey: "payout-1",
      merchantId: "merchant-1",
      amountMinor: RP_45_000_IN_SEN,
      currency: "IDR",
    });

    expect(driver.sent(payout._unsafeUnwrap().providerReference)).toBe(45_000);
  });

  it("refuses a payout it cannot make exactly", async () => {
    // A charge in the wrong unit overcharges a user who complains. A payout
    // in the wrong unit sends a merchant a hundred times what they are owed,
    // and nobody on the receiving end has a reason to mention it — so the
    // refusal matters more on this side, not less.
    const driver = createSimulatedDisbursement(undefined, {
      declaredMinorUnitExponent: { IDR: 0 },
    });
    const payout = await driver.payout({
      idempotencyKey: "payout-2",
      merchantId: "merchant-1",
      amountMinor: RP_45_000_IN_SEN + 1,
      currency: "IDR",
    });

    expect(payout.isErr()).toBe(true);
    expect(payout._unsafeUnwrapErr().kind).toBe("declined");
  });
});
