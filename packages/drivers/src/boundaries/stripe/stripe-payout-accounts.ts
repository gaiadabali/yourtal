import { randomUUID } from "node:crypto";
import { err, ok } from "neverthrow";
import type { BoundaryFailure } from "../../fault-engine";
import type { Environment } from "../../driver-mode";
import type { PayoutAccountsDriver } from "../payout-accounts";
import {
  createStripeClient,
  stripeConfigFromEnv,
  stripePath,
  unexpectedAnswer,
} from "./stripe-client";
import { STRIPE_EXPONENTS, stripeCurrency, toStripeAmount } from "./stripe-money";
import { findPayout, findTransfer, getPayout } from "./stripe-payout-readback";
import { bankLast4, bool, int, str } from "./stripe-object";

/**
 * Stripe Connect in AU: Express accounts on the requested payout schedule, hosted onboarding links, transfers from
 * the platform balance, and payouts made on the connected account itself (`Stripe-Account`).
 */

const BOUNDARY = "disbursement";

export interface StripePayoutAccountsConfig {
  readonly apiBase?: string;
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Idempotency key for account links, which move no money. Injectable for tests. */
  readonly newKey?: () => string;
}

function declined(detail: string): BoundaryFailure {
  return { kind: "declined", boundary: BOUNDARY, detail, mayHaveSucceeded: false };
}

export function createStripePayoutAccounts(
  config: StripePayoutAccountsConfig,
): PayoutAccountsDriver {
  const client = createStripeClient({ ...config, boundary: BOUNDARY });
  const newKey = config.newKey ?? randomUUID;

  return {
    mode: "live",
    provider: "stripe",
    declaredMinorUnitExponent: STRIPE_EXPONENTS,

    async createAccount(request) {
      const account = await client.post(
        "/v1/accounts",
        {
          type: "express",
          country: "AU",
          email: request.email,
          business_type: request.kind === "charity" ? "non_profit" : "company",
          // card_payments too: a charity is the on_behalf_of merchant of its auction's destination charges.
          capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
          settings: { payouts: { schedule: { interval: request.payoutSchedule } } },
          metadata: { reference: request.reference, kind: request.kind },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      if (account.isErr()) return err(account.error);
      const accountRef = str(account.value, "id");
      return accountRef === undefined
        ? err(unexpectedAnswer(BOUNDARY, "Stripe created an account without an id."))
        : ok({ accountRef });
    },

    async onboardingLink(request) {
      const link = await client.post(
        "/v1/account_links",
        {
          account: request.accountRef,
          refresh_url: request.refreshUrl,
          return_url: request.returnUrl,
          type: request.purpose === "update" ? "account_update" : "account_onboarding",
        },
        { idempotencyKey: `account-link:${newKey()}` },
      );
      if (link.isErr()) return err(link.error);
      const url = str(link.value, "url");
      const expiresAt = int(link.value, "expires_at");
      return url === undefined || expiresAt === undefined
        ? err(
            unexpectedAnswer(BOUNDARY, "Stripe answered an account link without a url or expiry."),
          )
        : ok({ url, expiresAt: new Date(expiresAt * 1_000) });
    },

    async getAccount(accountRef) {
      const account = await client.get(stripePath("accounts", accountRef));
      if (account.isErr()) return err(account.error);
      return ok({
        accountRef: str(account.value, "id") ?? accountRef,
        chargesEnabled: bool(account.value, "charges_enabled") ?? false,
        payoutsEnabled: bool(account.value, "payouts_enabled") ?? false,
        detailsSubmitted: bool(account.value, "details_submitted") ?? false,
        bankLast4: bankLast4(account.value),
      });
    },

    async transfer(request) {
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency);
      if (amount.isErr()) return err(amount.error);
      const transfer = await client.post(
        "/v1/transfers",
        {
          amount: amount.value,
          currency: stripeCurrency(request.currency),
          destination: request.accountRef,
          metadata: { reference: request.reference },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      if (transfer.isErr()) return err(transfer.error);
      const transferRef = str(transfer.value, "id");
      return transferRef === undefined
        ? err(unexpectedAnswer(BOUNDARY, "Stripe created a transfer without an id."))
        : ok({ transferRef });
    },

    async payout(request) {
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency);
      if (amount.isErr()) return err(amount.error);
      const payout = await client.post(
        "/v1/payouts",
        {
          amount: amount.value,
          currency: stripeCurrency(request.currency),
          metadata: { reference: request.reference },
        },
        { idempotencyKey: request.idempotencyKey, stripeAccount: request.accountRef },
      );
      if (payout.isErr()) return err(payout.error);
      const payoutRef = str(payout.value, "id");
      const status = str(payout.value, "status");
      if (payoutRef === undefined)
        return err(unexpectedAnswer(BOUNDARY, "Stripe created a payout without an id."));
      if (status === "paid") return ok({ payoutRef, status: "paid" as const });
      if (status === "pending" || status === "in_transit")
        return ok({ payoutRef, status: "pending" as const });
      return err(declined(`Payout ${payoutRef} is ${status ?? "unknown"}.`));
    },

    getPayout: (accountRef, payoutRef) => getPayout(client, accountRef, payoutRef),
    findPayout: (request) => findPayout(client, request),
    findTransfer: (request) => findTransfer(client, request),
  };
}

export function createStripePayoutAccountsFromEnv(
  env: Environment,
  fetchImpl?: typeof fetch,
): PayoutAccountsDriver {
  const config = stripeConfigFromEnv(env);
  return createStripePayoutAccounts({
    apiBase: config.apiBase,
    secretKey: config.secretKey,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}
