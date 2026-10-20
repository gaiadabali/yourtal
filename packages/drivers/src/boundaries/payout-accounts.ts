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
  const now = options.nowMs ?? Date.now;
  const exponents: Partial<Record<Currency, number>> = {
    AUD: options.declaredMinorUnitExponent?.AUD ?? 2,
    ...(options.declaredMinorUnitExponent?.IDR !== undefined
      ? { IDR: options.declaredMinorUnitExponent.IDR }
      : {}),
  };
  const refuse = (detail: string): Result<never, BoundaryFailure> =>
    err({ kind: "declined", boundary: "disbursement", detail, mayHaveSucceeded: false });

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
  };
}
