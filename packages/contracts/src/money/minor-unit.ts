import type { Currency } from "./currency";

/**
 * How many decimal places a currency's stored integer represents — and, just
 * as importantly, **whether we actually know**. Dependency-free for the same
 * reason `currency.ts` is: `money-format.ts` value-imports it.
 *
 * ## The exponent is not part of the Money type, on purpose
 *
 * A `Money` can be stored, transported, added, subtracted and compared
 * without anyone knowing its exponent. The ledger already works this way —
 * `services/ledger` moves `amount_minor` integers and never interprets them,
 * which is why YT-0039 could ship while YT-0506 was still open.
 *
 * Only two operations genuinely need the exponent: **rendering** an amount
 * for a human, and **settling** one through a payment processor. Keeping it
 * out of the core means the open question blocks those two things and
 * nothing else, rather than blocking everything that touches money.
 *
 * This is the same split YT-0537 asks for when it says the money unit is "a
 * declared property of the payment driver, not a constant baked into the
 * simulator". A driver declares the unit it speaks; this table declares the
 * unit we store; a parity test compares them. None of that works if the
 * exponent is a constant welded to the amount.
 *
 * ## `status` records whether a unit is evidenced, not whether it is guessed
 *
 * IDR was `provisional` here while YT-0506 was open. The founder settled it
 * on 2026-09-20 — **IDR has a sen minor unit and we store it, exponent 2** —
 * so the entry is now `confirmed` and `assertUnitSettled` lets IDR through.
 *
 * The field stays because it earned its keep. While IDR was provisional,
 * `assertUnitSettled` blocked settlement and left display working, which is
 * what let the rest of the platform proceed without anyone guessing. The next
 * currency will arrive unevidenced too.
 *
 * **What the decision did NOT settle is what Xendit accepts**, and that was
 * always the second question. Adyen flags IDR as diverging from ISO precisely
 * because processors differ, so the conversion belongs in each PSP adapter
 * rather than in a constant here — which is what YT-0537 already encodes by
 * making the money unit a declared property of the driver. This table says
 * what we STORE. A driver says what it SPEAKS. A parity test compares them.
 */
export interface MinorUnit {
  /** Decimal places in the stored integer: 2 means the integer is cents. */
  readonly exponent: number;
  /**
   * `confirmed` — evidenced against the processor we will actually settle
   * through. `provisional` — what the code currently does, pending that
   * evidence. Only `confirmed` may move money.
   */
  readonly status: "confirmed" | "provisional";
  /** Why the exponent is what it is, so the next reader need not re-research. */
  readonly evidence: string;
}

export const MINOR_UNIT: Record<Currency, MinorUnit> = {
  AUD: {
    exponent: 2,
    status: "confirmed",
    evidence:
      "AUD is unambiguously two-decimal: cents are legal tender, ISO 4217 agrees, " +
      "and Stripe — our Australian processor — takes AUD in cents. No processor " +
      "disputes this, so nothing here is waiting on anyone.",
  },
  IDR: {
    exponent: 2,
    status: "confirmed",
    evidence:
      "FOUNDER DECISION, 2026-09-20 (YT-0506): IDR has a sen minor unit and we store it. " +
      "Sen is uncommon in daily use but banking uses it — amounts appear as Rp 1.000,26. " +
      "This matches ISO 4217 and Stripe's treatment, and restores the original intent of " +
      "docs/12, docs/18 and YT-0041. SETTLES THE CURRENCY, NOT THE PROCESSOR: what Xendit's " +
      "API accepts is still unconfirmed, and Adyen flags IDR as diverging from ISO precisely " +
      "because processors differ. That conversion belongs in each PSP adapter, which is what " +
      "YT-0537 encodes by making the unit a declared property of the payment driver.",
  },
};

/**
 * The exponent, whatever its status. Formatting calls this: a provisional
 * exponent still renders the numbers a user sees today, and refusing to
 * render would take down every working IDR screen to make a point that
 * belongs on the settlement path instead.
 */
export function minorUnitExponent(currency: Currency): number {
  return MINOR_UNIT[currency].exponent;
}

export function isUnitSettled(currency: Currency): boolean {
  return MINOR_UNIT[currency].status === "confirmed";
}

/** Thrown when money would move in a currency whose unit is still open. */
export class UnsettledMinorUnitError extends Error {
  readonly currency: Currency;

  constructor(currency: Currency, operation: string, evidence?: string) {
    super(
      `Refusing to ${operation} in ${currency}: its minor unit is not settled (YT-0506). ` +
        (evidence ?? MINOR_UNIT[currency].evidence),
    );
    this.name = "UnsettledMinorUnitError";
    this.currency = currency;
  }
}

/**
 * The gate every settlement, payout, pricing and PSP path must pass.
 *
 * Throws rather than returning a flag, and takes the operation name so the
 * message says what was about to happen. A caller that wants to branch has
 * `isUnitSettled`; a caller that forgets entirely gets stopped, which is the
 * whole point — the 100x error this guards is invisible in every test
 * because both sides of it agree internally.
 *
 * Deliberately NOT called by `formatMoney`. Display is not settlement, and
 * conflating them would mean the safe thing is also the thing that breaks
 * the app, so somebody would eventually remove it.
 */
export function assertUnitSettled(currency: Currency, operation: string): void {
  assertSettled(MINOR_UNIT[currency], currency, operation);
}

/**
 * The refusal itself, against a `MinorUnit` the caller supplies.
 *
 * Split out from `assertUnitSettled` when YT-0506 settled IDR, because that
 * left **no provisional currency in the table** — and a guard with nothing
 * to refuse is a guard whose refusal path never executes. The test for it
 * would have had to be deleted or left asserting nothing, and the next
 * currency to arrive unevidenced would be the first to find out whether this
 * still worked.
 *
 * So the logic takes the record rather than reading the global, and the test
 * hands it a provisional one. The mechanism stays proved while the table has
 * nothing provisional in it, which is the only arrangement in which it will
 * still be correct when something does.
 */
export function assertSettled(unit: MinorUnit, currency: Currency, operation: string): void {
  if (unit.status !== "confirmed") {
    throw new UnsettledMinorUnitError(currency, operation, unit.evidence);
  }
}
