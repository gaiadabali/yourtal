import { createHash } from "node:crypto";
import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode } from "../driver-mode";
import { toProviderAmount } from "./provider-amount";

/**
 * Accounts that YourTal pays out to (businesses' statements, charities' auction proceeds): Stripe Connect Express
 * accounts in AU, this simulator in ID (F104) and in tests. Moving money to an account is a `transfer` from the
 * platform balance; `payout` then moves the account's balance to its bank.
 */

export interface PayoutAccount {
  readonly accountRef: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly bankLast4: string | null;
}

export interface CreatePayoutAccountRequest {
  readonly idempotencyKey: string;
  readonly reference: string;
  readonly kind: "business" | "charity";
  readonly email?: string;
  readonly payoutSchedule: "manual" | "daily";
}

export interface OnboardingLinkRequest {
  readonly accountRef: string;
  readonly returnUrl: string;
  readonly refreshUrl: string;
  readonly purpose: "onboarding" | "update";
}

export interface MoneyToAccountRequest {
  readonly idempotencyKey: string;
  /** In OUR stored minor units. */
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly accountRef: string;
  readonly reference: string;
}

export type PayoutProgress = "pending" | "paid" | "failed";

/** A payout as the processor shows it. `pending` covers Stripe's pending and in_transit. */
export interface PayoutDetails {
  readonly payoutRef: string;
  readonly status: PayoutProgress;
  /** OUR minor units (converted back from provider units). */
  readonly amountMinor: number;
  readonly currency: Currency;
  /** The metadata.reference we sent with the payout, e.g. "disbursement:<id>:<attempt>". */
  readonly reference: string | null;
  /** Set only when status is "failed". */
  readonly failureCode: string | null;
}

export interface TransferDetails {
  readonly transferRef: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  /** metadata.reference, e.g. "disbursement:<id>". */
  readonly reference: string | null;
}

export interface FindMoneyRequest {
  readonly accountRef: string;
  /** The metadata.reference to look for. */
  readonly reference: string;
  /** Only objects created at or after this are looked at. */
  readonly since: Date;
}

export interface PayoutAccountsDriver {
  readonly mode: DriverMode;
  readonly provider: "stripe" | "simulated";
  readonly declaredMinorUnitExponent: Partial<Record<Currency, number>>;
  createAccount(
    request: CreatePayoutAccountRequest,
  ): Promise<Result<{ readonly accountRef: string }, BoundaryFailure>>;
  onboardingLink(
    request: OnboardingLinkRequest,
  ): Promise<Result<{ readonly url: string; readonly expiresAt: Date }, BoundaryFailure>>;
  getAccount(accountRef: string): Promise<Result<PayoutAccount, BoundaryFailure>>;
  transfer(
    request: MoneyToAccountRequest,
  ): Promise<Result<{ readonly transferRef: string }, BoundaryFailure>>;
  payout(
    request: MoneyToAccountRequest,
  ): Promise<
    Result<{ readonly payoutRef: string; readonly status: "pending" | "paid" }, BoundaryFailure>
  >;
  getPayout(accountRef: string, payoutRef: string): Promise<Result<PayoutDetails, BoundaryFailure>>;
  /**
   * For a lost answer: the app has only the reference it sent. `null` MEANS "the processor shows nothing", so it is
   * returned only after scanning everything since `since`; a scan cut short is a may-have-succeeded failure.
   */
  findPayout(request: FindMoneyRequest): Promise<Result<PayoutDetails | null, BoundaryFailure>>;
  findTransfer(request: FindMoneyRequest): Promise<Result<TransferDetails | null, BoundaryFailure>>;
}

export interface SimulatedPayoutAccountsDriver extends PayoutAccountsDriver {
  /** What the provider was asked to move, in PROVIDER units, by transfer or payout reference. For parity tests. */
  sent(reference: string): number | undefined;
}

export interface SimulatedPayoutAccountsOptions {
  /** AUD defaults to cents; IDR has no default (see payments.ts), so ID's caller declares it. */
  readonly declaredMinorUnitExponent?: Partial<Record<Currency, number>>;
  readonly nowMs?: () => number;
}

/** Every simulated account is already onboarded, with this bank account. */
export const SIMULATED_BANK_LAST4 = "3456";
const ACCOUNT_PREFIX = "simacct_";

function reference(prefix: string, key: string): string {
  return `${prefix}${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/**
 * Stateless like the marketplace simulator: references derive from idempotency keys and every `simacct_` account
 * reads as onboarded, so an account created before a restart still works after it.
 */
export function createSimulatedPayoutAccounts(
  faultPlan?: FaultPlan,
  options: SimulatedPayoutAccountsOptions = {},
): SimulatedPayoutAccountsDriver {
  const engine = new FaultEngine(faultPlan);
  const sentToProvider = new Map<string, number>();
  // What was moved, by ref and by the reference sent, so a read-back can answer within one driver instance.
  const payouts = new Map<string, PayoutDetails>();
  const transfers = new Map<string, TransferDetails>();
  const now = options.nowMs ?? Date.now;
  const exponents: Partial<Record<Currency, number>> = {
    AUD: options.declaredMinorUnitExponent?.AUD ?? 2,
    ...(options.declaredMinorUnitExponent?.IDR !== undefined
      ? { IDR: options.declaredMinorUnitExponent.IDR }
      : {}),
  };
  const refuse = (detail: string): Result<never, BoundaryFailure> =>
    err({ kind: "declined", boundary: "disbursement", detail, mayHaveSucceeded: false });

  function gate(accountRef: string): Result<void, BoundaryFailure> {
    if (!accountRef.startsWith(ACCOUNT_PREFIX)) return refuse(`No such account ${accountRef}.`);
    const directive = engine.nextCall();
    return directive === "proceed" ? ok(undefined) : err(failureFor("disbursement", directive));
  }

  function move(prefix: string, request: MoneyToAccountRequest): Result<string, BoundaryFailure> {
    const exponent = exponents[request.currency];
    if (exponent === undefined)
      return refuse(`No declared minor-unit exponent for ${request.currency}.`);
    if (!request.accountRef.startsWith(ACCOUNT_PREFIX))
      return refuse(`No such account ${request.accountRef}.`);
    const directive = engine.nextCall();
    if (directive !== "proceed") return err(failureFor("disbursement", directive));
    const amount = toProviderAmount(request.amountMinor, request.currency, exponent);
    if (amount.isErr()) return refuse(amount.error.detail);
    const ref = reference(prefix, request.idempotencyKey);
    sentToProvider.set(ref, amount.value);
    const known = { amountMinor: request.amountMinor, currency: request.currency };
    if (prefix === "simpo_") {
      const details: PayoutDetails = {
        payoutRef: ref,
        status: "paid",
        ...known,
        reference: request.reference,
        failureCode: null,
      };
      payouts.set(ref, details);
      payouts.set(request.reference, details);
    } else {
      const details: TransferDetails = {
        transferRef: ref,
        ...known,
        reference: request.reference,
      };
      transfers.set(ref, details);
      transfers.set(request.reference, details);
    }
    return ok(ref);
  }

  return {
    mode: "simulated",
    provider: "simulated",
    declaredMinorUnitExponent: exponents,
    sent: (ref) => sentToProvider.get(ref),

    createAccount(request) {
      const directive = engine.nextCall();
      if (directive !== "proceed")
        return Promise.resolve(err(failureFor("disbursement", directive)));
      return Promise.resolve(ok({ accountRef: reference(ACCOUNT_PREFIX, request.idempotencyKey) }));
    },
    onboardingLink(request) {
      // Nothing to fill in: the simulated account is onboarded already, so the link goes straight back.
      return Promise.resolve(
        ok({ url: request.returnUrl, expiresAt: new Date(now() + 30 * 60_000) }),
      );
    },
    getAccount(accountRef) {
      if (!accountRef.startsWith(ACCOUNT_PREFIX))
        return Promise.resolve(refuse(`No such account ${accountRef}.`));
      return Promise.resolve(
        ok({
          accountRef,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          bankLast4: SIMULATED_BANK_LAST4,
        }),
      );
    },
    transfer(request) {
      return Promise.resolve(move("simtr_", request).map((transferRef) => ({ transferRef })));
    },
    payout(request) {
      return Promise.resolve(
        move("simpo_", request).map((payoutRef) => ({ payoutRef, status: "paid" as const })),
      );
    },
    getPayout(accountRef, payoutRef) {
      const allowed = gate(accountRef);
      if (allowed.isErr()) return Promise.resolve(err(allowed.error));
      const found = payouts.get(payoutRef);
      return Promise.resolve(
        found?.payoutRef === payoutRef ? ok(found) : refuse(`No such payout ${payoutRef}.`),
      );
    },
    findPayout(request) {
      const allowed = gate(request.accountRef);
      if (allowed.isErr()) return Promise.resolve(err(allowed.error));
      return Promise.resolve(ok(payouts.get(request.reference) ?? null));
    },
    findTransfer(request) {
      const allowed = gate(request.accountRef);
      if (allowed.isErr()) return Promise.resolve(err(allowed.error));
      return Promise.resolve(ok(transfers.get(request.reference) ?? null));
    },
  };
}
