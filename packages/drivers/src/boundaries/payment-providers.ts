import type { Region } from "@yourtal/contracts/region";
import { DriverConfigurationError, type Environment, resolveDriverMode } from "../driver-mode";
import type { BoundaryName } from "../boundary";
import type { FaultPlan } from "../faults";
import {
  type MarketplacePaymentsDriver,
  createSimulatedMarketplacePayments,
} from "./marketplace-payments";
import { type PaymentsDriver, createSimulatedPayments, simulatedProcessorUnits } from "./payments";
import { type PayoutAccountsDriver, createSimulatedPayoutAccounts } from "./payout-accounts";
import { createStripeMarketplaceFromEnv } from "./stripe/stripe-marketplace";
import { createStripePaymentsFromEnv } from "./stripe/stripe-payments";
import { createStripePayoutAccountsFromEnv } from "./stripe/stripe-payout-accounts";

/** The one place that picks the payment drivers for each region. */

export interface PaymentProviders {
  readonly payments: PaymentsDriver;
  readonly marketplace: MarketplacePaymentsDriver;
  readonly payoutAccounts: PayoutAccountsDriver;
}

export interface PaymentProvidersOptions {
  /** Injected into the Stripe drivers; tests pass a recording double. */
  readonly fetch?: typeof fetch;
  /** Faults for the simulated drivers, by boundary. */
  readonly faults?: Partial<Record<"payments" | "disbursement", FaultPlan>>;
}

function modeOf(boundary: BoundaryName, env: Environment) {
  const mode = resolveDriverMode(boundary, env);
  // The boot check reports this first; throwing again here keeps a misconfigured live from becoming simulated.
  if (mode.isErr()) throw new DriverConfigurationError([mode.error]);
  return mode.value;
}

function simulated(options: PaymentProvidersOptions): PaymentProviders {
  const units = { declaredMinorUnitExponent: simulatedProcessorUnits() };
  return {
    payments: createSimulatedPayments(options.faults?.payments, units),
    marketplace: createSimulatedMarketplacePayments(options.faults?.payments),
    payoutAccounts: createSimulatedPayoutAccounts(options.faults?.disbursement, units),
  };
}

/** A customer of a user as our rows record it (`payment.customer`). */
export interface StoredPaymentCustomer {
  readonly provider: "stripe" | "simulated";
  readonly region: Region;
  readonly customerRef: string;
}

/**
 * Deletes a user's customer, and its saved cards, at the processor that holds it (account deletion, 5.1.h).
 * Resolves when it is gone; throws when it could not be, so the caller keeps its own rows. A simulated customer
 * holds nothing at Stripe, so a Stripe driver skips it; a Stripe customer with no Stripe driver running here
 * cannot be reached, which is a failure rather than something to forget.
 */
export function processorCustomerDeleter(
  providers: Readonly<Record<Region, PaymentProviders>>,
): (customer: StoredPaymentCustomer) => Promise<void> {
  return async (customer) => {
    const driver = providers[customer.region].payments;
    if (driver.provider !== customer.provider) {
      if (customer.provider === "simulated") return;
      throw new Error(
        `No ${customer.provider} payments driver is running to delete this customer.`,
      );
    }
    const deleted = await driver.deleteCustomer(customer.customerRef);
    if (deleted.isErr()) throw new Error(deleted.error.detail);
  };
}

/** AU: Stripe when PAYMENTS_DRIVER / DISBURSEMENT_DRIVER = live, else simulated. ID: always simulated. */
export function createPaymentProviders(
  env: Environment,
  options: PaymentProvidersOptions = {},
): Readonly<Record<Region, PaymentProviders>> {
  const paymentsLive = modeOf("payments", env) === "live";
  const disbursementLive = modeOf("disbursement", env) === "live";
  const auSimulated = simulated(options);

  return {
    AU: {
      payments: paymentsLive
        ? createStripePaymentsFromEnv(env, options.fetch)
        : auSimulated.payments,
      marketplace: paymentsLive
        ? createStripeMarketplaceFromEnv(env, options.fetch)
        : auSimulated.marketplace,
      payoutAccounts: disbursementLive
        ? createStripePayoutAccountsFromEnv(env, options.fetch)
        : auSimulated.payoutAccounts,
    },
    // F104: Indonesia stays on the Xendit-shaped simulated drivers, whatever the mode variables say.
    ID: simulated(options),
  };
}
