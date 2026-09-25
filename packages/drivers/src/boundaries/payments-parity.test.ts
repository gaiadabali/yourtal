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
 * That would be **wrong**: a processor legitimately wanting a different unit
 * is not a bug, it is the case this whole design exists to support. Asserting
 * equality would forbid the thing we built.
 *
 * What must hold is that **the same real-world amount comes out the other
 * side**. A stored amount of 45_000 at exponent 0 and 4_500_000 at exponent 2
 * both denote the same 45,000 whole units. That property catches a 100x
 * error whichever direction the mistake runs, and it permits a processor
 * that genuinely differs from what we store.
 *
 * ## Neither side derives from the other
 *
 * `MINOR_UNIT` says what we store. The driver says what it speaks. If the
 * driver read its exponent from `MINOR_UNIT` these tests would be comparing
 * a value to itself — which is exactly what `openapi:go:check` was doing
 * when it compared the generator's output to the generator's output, and
 * exactly why nobody noticed the Go module had never compiled.
 *
 * ## Since decision T-1, IDR has no platform default either
 *
 * Storage and Xendit now agree (both whole Rupiah, exponent 0), which makes
 * it tempting to let the simulator default IDR the way it always defaulted
 * AUD. That temptation is itself the 100x hazard: a driver that inherits
 * *today's* agreement stops noticing the day a real vendor disagrees. So the
 * "honest driver" case below still declares its unit explicitly, and a
 * separate suite proves the undeclared case is refused rather than guessed.
 */

const RP_45_000 = 45_000; // stored AND Xendit's own unit — both exponent 0 since decision T-1.

describe("the platform's own declaration", () => {
  it("stores IDR in whole Rupiah and AUD in cents", () => {
    // If this moves, every expectation below is about a different world.
    // Failing here first is more useful than failing in the conversions.
    expect(minorUnitExponent("IDR")).toBe(0);
    expect(minorUnitExponent("AUD")).toBe(2);
    expect(MINOR_UNIT.IDR.status).toBe("confirmed");
  });
});

describe("the honest IDR driver: Xendit speaks the same whole-Rupiah unit we store", () => {
  const driver = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: { IDR: 0 },
  });

  it("sends the stored integer unchanged", async () => {
    const charge = await driver.charge({
      idempotencyKey: "same-unit",
      amountMinor: RP_45_000,
      currency: "IDR",
      reference: "top-up-1",
    });

    const received = driver.received(charge._unsafeUnwrap().providerReference);
    expect(received?.amount).toBe(RP_45_000);
  });

  it("declares an exponent for every currency it was told", () => {
    // A currency the platform prices in but the driver has not declared is a
    // settlement waiting to be made in a unit nobody chose.
    for (const currency of CURRENCY_CODES) {
      expect(driver.declaredMinorUnitExponent[currency]).toBeTypeOf("number");
    }
  });
});

describe("IDR has no platform-wide default", () => {
  // The dangerous case decision T-1 introduced: storage and Xendit now
  // happen to agree, so a driver that silently defaulted IDR would pass
  // every test above right up until a vendor that disagrees showed up.
  it("refuses to charge IDR when the driver was never told what its processor speaks", async () => {
    const driver = createSimulatedPayments();
    const charge = await driver.charge({
      idempotencyKey: "undeclared-idr",
      amountMinor: RP_45_000,
      currency: "IDR",
      reference: "top-up-undeclared",
    });
    expect(charge.isErr()).toBe(true);
  });

  it("still charges AUD without any declaration, because AUD's unit is unambiguous", async () => {
    const driver = createSimulatedPayments();
    const charge = await driver.charge({
      idempotencyKey: "aud-default",
      amountMinor: 1_250,
      currency: "AUD",
      reference: "top-up-aud",
    });
    expect(charge.isOk()).toBe(true);
  });
});

describe("a driver whose declaration does not match what it sends", () => {
  /**
   * The test that gives this suite its point.
   *
   * Built with a fabricated test double, not a real vendor — the mismatch
   * this driver models (claiming a finer unit than it actually sends) does
   * not currently correspond to any live IDR processor, now that storage and
   * Xendit agree. That is exactly why it has to be constructed rather than
   * found: without it, the suite could only ever prove the correct case,
   * which says nothing about whether it would catch the wrong one. A guard
   * that has never been seen to fail has not been shown to work.
   */
  const misdeclared = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: { IDR: 2 }, // claims sen-like precision it does not have
    convertAmounts: false,
  });

  it("is caught by the parity check", async () => {
    const charge = await misdeclared.charge({
      idempotencyKey: "misdeclared",
      amountMinor: RP_45_000,
      currency: "IDR",
      reference: "top-up-4",
    });

    const received = misdeclared.received(charge._unsafeUnwrap().providerReference);
    expect(received?.amount).toBe(RP_45_000); // it sent the raw stored integer, unconverted

    // Read back through the unit it CLAIMS, the amount is 100x too SMALL —
    // it under-reads because the driver claims a finer unit than it sends.
    const asDeclared = fromProviderAmount(
      received?.amount ?? -1,
      "IDR",
      misdeclared.declaredMinorUnitExponent.IDR ?? -1,
    );
    expect(asDeclared._unsafeUnwrap()).toBe(RP_45_000 / 100);
    expect(asDeclared._unsafeUnwrap()).not.toBe(RP_45_000);
  });

  it("fails the round-trip property every honest driver satisfies", async () => {
    // Stated as the general property rather than a specific number, because
    // this is the assertion a real parity suite runs against a live vendor.
    const charge = await misdeclared.charge({
      idempotencyKey: "misdeclared-2",
      amountMinor: RP_45_000,
      currency: "IDR",
      reference: "top-up-5",
    });
    const received = misdeclared.received(charge._unsafeUnwrap().providerReference);

    const roundTripped = fromProviderAmount(
      received?.amount ?? -1,
      "IDR",
      misdeclared.declaredMinorUnitExponent.IDR ?? -1,
    );
    expect(roundTripped._unsafeUnwrap()).not.toBe(RP_45_000);
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
  it("pays Xendit the stored integer unchanged", async () => {
    const driver = createSimulatedDisbursement(undefined, {
      declaredMinorUnitExponent: { IDR: 0 },
    });
    const payout = await driver.payout({
      idempotencyKey: "payout-1",
      merchantId: "merchant-1",
      amountMinor: RP_45_000,
      currency: "IDR",
    });

    expect(driver.sent(payout._unsafeUnwrap().providerReference)).toBe(RP_45_000);
  });

  it("refuses a payout it cannot make exactly", async () => {
    // A charge in the wrong unit overcharges a user who complains. A payout
    // in the wrong unit sends a merchant a hundred times what they are owed,
    // and nobody on the receiving end has a reason to mention it — so the
    // refusal matters more on this side, not less.
    //
    // AUD, not IDR: storage and Xendit now agree on IDR's whole-Rupiah unit,
    // so no IDR amount is inexact any more. A hypothetical processor wanting
    // whole AUD dollars demonstrates the same "no rounding" rule instead.
    const driver = createSimulatedDisbursement(undefined, {
      declaredMinorUnitExponent: { AUD: 0 },
    });
    const payout = await driver.payout({
      idempotencyKey: "payout-2",
      merchantId: "merchant-1",
      amountMinor: 1_251, // $12.51 — not a whole-dollar amount
      currency: "AUD",
    });

    expect(payout.isErr()).toBe(true);
    expect(payout._unsafeUnwrapErr().kind).toBe("declined");
  });
});
