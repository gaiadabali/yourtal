import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { PayoutAccount as PayoutAccountView } from "@yourtal/contracts/billing/payouts";
import type { BoundaryFailure } from "@yourtal/drivers/fault-engine";
import type { PayoutAccount, PayoutAccountsDriver } from "@yourtal/drivers/payout-accounts";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import type { PaymentEventHandlers } from "../payments/payment-event-handlers";
import type {
  ConnectedAccountRepository,
  ConnectedAccountRow,
  PayoutOwner,
} from "./connected-account.repository";
import type { DisbursementRepository } from "./disbursement.repository";

export const CONNECTED_ACCOUNTS_SERVICE = Symbol("CONNECTED_ACCOUNTS_SERVICE");

export type ConnectedAccountStore = {
  [K in keyof ConnectedAccountRepository]: ConnectedAccountRepository[K];
};
export type PayoutSettlementStore = Pick<DisbursementRepository, "settlePayout">;

/** Paths on the web app the processor's page comes back to. */
export interface OnboardingPaths {
  /** Where the browser lands when the details are submitted. */
  readonly returnPath: string;
  /** Where an expired link sends the browser, to be given a fresh one. */
  readonly refreshPath: string;
}

/** Called whenever an account is found charges- and payouts-enabled. Must be idempotent. */
export type ReadyListener = (row: ConnectedAccountRow) => Promise<void>;

export function isReady(row: Pick<ConnectedAccountRow, "chargesEnabled" | "payoutsEnabled">) {
  return row.chargesEnabled && row.payoutsEnabled;
}

function samePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * 5.2 (F103): the connected accounts brands and charities are paid out to,
 * in Australia only (F104: Indonesia gets none). An account is created once
 * per owner, on the provider's `manual` schedule for a brand (each payout is
 * tied to a statement) and `daily` for a charity (auction proceeds). The
 * provider's onboarding page fills it in; `account.updated` brings it back.
 */
export class ConnectedAccountsService {
  private readonly readyListeners: ReadyListener[] = [];

  constructor(
    private readonly providers: RegionPaymentProviders,
    private readonly accounts: ConnectedAccountStore,
    private readonly webOrigin: string,
  ) {}

  driver(): PayoutAccountsDriver {
    return this.providers.AU.payoutAccounts;
  }

  whenReady(listener: ReadyListener): void {
    this.readyListeners.push(listener);
  }

  /** The owner's account as Studio or the charity console shows it; re-read while it is being set up. */
  async status(owner: PayoutOwner | null): Promise<PayoutAccountView> {
    if (owner === null) {
      return { available: false, state: "not_started", bankLast4: null, hostedOnboarding: false };
    }
    let row = await this.accounts.findByOwner(owner, this.driver().provider);
    if (row !== null && !isReady(row)) row = (await this.refresh(row.accountRef, false)) ?? row;
    return view(row, this.driver().provider === "stripe");
  }

  async findForOwner(owner: PayoutOwner): Promise<ConnectedAccountRow | null> {
    return this.accounts.findByOwner(owner, this.driver().provider);
  }

  /** A link to the provider's page: onboarding the first time, a bank-details update afterwards. */
  async startLink(
    owner: PayoutOwner,
    paths: OnboardingPaths,
  ): Promise<Result<{ readonly url: string }, BoundaryFailure>> {
    if (!samePath(paths.returnPath) || !samePath(paths.refreshPath)) {
      throw new Error("Onboarding must return to paths on the web app.");
    }
    const account = await this.ensureAccount(owner);
    if (account.isErr()) return err(account.error);
    const driver = this.driver();
    const back = paths.returnPath.includes("?") ? "&" : "?";
    const link = await driver.onboardingLink({
      accountRef: account.value.accountRef,
      returnUrl: `${this.webOrigin}${paths.returnPath}${back}payouts=returned`,
      refreshUrl: `${this.webOrigin}${paths.refreshPath}`,
      purpose: account.value.detailsSubmitted ? "update" : "onboarding",
    });
    if (link.isErr()) return err(link.error);
    // The simulated provider asks nothing, so its account is ready now.
    if (driver.provider === "simulated") await this.refresh(account.value.accountRef, false);
    return ok({ url: link.value.url });
  }

  /** Account and payout events. Every handler ignores what is not ours and is safe to run twice. */
  registerHandlers(handlers: PaymentEventHandlers, disbursements: PayoutSettlementStore): void {
    handlers.on("account.updated", async (event) => {
      if ((await this.accounts.findByRef(event.accountRef)) === null) return;
      // Re-read: deliveries can arrive out of order, so the event's snapshot may be stale.
      await this.refresh(event.accountRef, true);
    });
    const settle = (outcome: "paid" | "failed") => async (event: PayoutEventLike) => {
      await disbursements.settlePayout({
        accountRef: event.accountRef,
        payoutRef: event.payoutRef,
        reference: event.reference,
        outcome,
        failureCode: event.failureCode,
      });
    };
    handlers.on("payout.paid", settle("paid"));
    handlers.on("payout.failed", settle("failed"));
  }

  private async ensureAccount(
    owner: PayoutOwner,
  ): Promise<Result<ConnectedAccountRow, BoundaryFailure>> {
    const driver = this.driver();
    const existing = await this.accounts.findByOwner(owner, driver.provider);
    if (existing !== null) return ok(existing);
    // Keyed on the owner: a retry or a concurrent first call gets the same account back.
    const created = await driver.createAccount({
      idempotencyKey: `connected-account:${owner.kind}:${owner.id}`,
      reference: `${owner.kind}:${owner.id}`,
      kind: owner.kind,
      payoutSchedule: owner.kind === "business" ? "manual" : "daily",
    });
    if (created.isErr()) return err(created.error);
    return ok(await this.accounts.save(owner, driver.provider, created.value.accountRef));
  }

  /**
   * Stores the provider's view. A read for the status page writes only when
   * something changed, so looking at the page never counts as an account update.
   */
  private async refresh(accountRef: string, always: boolean): Promise<ConnectedAccountRow | null> {
    const fetched = await this.driver().getAccount(accountRef);
    if (fetched.isErr()) {
      if (always) throw new Error(`account ${accountRef}: ${fetched.error.detail}`);
      return null;
    }
    const current = await this.accounts.findByRef(accountRef);
    if (current === null) return null;
    const row =
      always || changed(current, fetched.value)
        ? await this.accounts.update(fetched.value)
        : current;
    if (row !== null && isReady(row)) {
      for (const listener of this.readyListeners) await listener(row);
    }
    return row;
  }
}

type PayoutEventLike = {
  readonly accountRef: string;
  readonly payoutRef: string;
  readonly reference: string | null;
  readonly failureCode: string | null;
};

function changed(row: ConnectedAccountRow, account: PayoutAccount): boolean {
  return (
    row.chargesEnabled !== account.chargesEnabled ||
    row.payoutsEnabled !== account.payoutsEnabled ||
    row.detailsSubmitted !== account.detailsSubmitted ||
    row.bankLast4 !== account.bankLast4
  );
}

function view(row: ConnectedAccountRow | null, hostedOnboarding: boolean): PayoutAccountView {
  const state = row === null ? "not_started" : isReady(row) ? "ready" : "in_progress";
  return { available: true, state, bankLast4: row?.bankLast4 ?? null, hostedOnboarding };
}
