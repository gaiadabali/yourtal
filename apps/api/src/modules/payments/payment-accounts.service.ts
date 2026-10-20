import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { BoundaryFailure } from "@yourtal/drivers/fault-engine";
import type { PaymentEvent, PaymentsDriver, SavedCard } from "@yourtal/drivers/payments";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import type { PaymentEventHandlers } from "./payment-event-handlers";
import { referenceId } from "./payment-event-handlers";
import type {
  PaymentAccountsRepository,
  PaymentOwner,
  StoredCard,
} from "./payment-accounts.repository";

export const PAYMENT_ACCOUNTS_SERVICE = Symbol("PAYMENT_ACCOUNTS_SERVICE");

/** The repository's public surface, so tests can hand in an in-memory one. */
export type PaymentAccountsStore = {
  [K in keyof PaymentAccountsRepository]: PaymentAccountsRepository[K];
};

export type CardSetupAnswer =
  | { readonly kind: "redirect"; readonly checkoutUrl: string }
  | { readonly kind: "saved"; readonly card: SavedCard };

const SETUP_PREFIX = "card-setup";

/** A region's language for the processor's pages. */
export function checkoutLocale(region: PaymentOwner["region"]): "en" | "id" {
  return region === "ID" ? "id" : "en";
}

/**
 * Customers and saved cards, shared by billing (boosts) and auctions (bids).
 * A customer is created once per owner, on demand. A card is saved through
 * the processor's own page (Stripe) or at once (the simulated driver), and
 * replaced when a new one is saved.
 */
export class PaymentAccountsService {
  constructor(
    private readonly providers: RegionPaymentProviders,
    private readonly accounts: PaymentAccountsStore,
    private readonly webOrigin: string,
  ) {}

  driverFor(owner: PaymentOwner): PaymentsDriver {
    return this.providers[owner.region].payments;
  }

  async ensureCustomer(owner: PaymentOwner): Promise<Result<string, BoundaryFailure>> {
    const driver = this.driverFor(owner);
    const existing = await this.accounts.findCustomer(owner, driver.provider);
    if (existing !== null) return ok(existing);
    // Keyed on the owner: a retry or a concurrent first call gets the same customer back.
    const created = await driver.createCustomer({
      idempotencyKey: `customer:${owner.kind}:${owner.id}`,
      reference: `${owner.kind}:${owner.id}`,
    });
    if (created.isErr()) return err(created.error);
    return ok(await this.accounts.saveCustomer(owner, driver.provider, created.value.customerRef));
  }

  liveCard(owner: PaymentOwner): Promise<StoredCard | null> {
    return this.accounts.liveCard(owner, this.driverFor(owner).provider);
  }

  /** True when this owner's processor charges only saved cards and none is saved yet. */
  async cardRequired(owner: PaymentOwner): Promise<boolean> {
    if (!this.driverFor(owner).needsSavedCard) return false;
    return (await this.liveCard(owner)) === null;
  }

  /** `returnPath` is a path on the web app (e.g. `/studio/billing?business=…`) the page comes back to. */
  async startCardSetup(
    owner: PaymentOwner,
    returnPath: string,
  ): Promise<Result<CardSetupAnswer, BoundaryFailure>> {
    if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
      throw new Error(`A card setup must return to a path on the web app, not ${returnPath}.`);
    }
    const driver = this.driverFor(owner);
    const customer = await this.ensureCustomer(owner);
    if (customer.isErr()) return err(customer.error);
    const setupId = await this.accounts.createSetup(owner, driver.provider, returnPath);
    const back = (outcome: string) =>
      `${this.webOrigin}${returnPath}${returnPath.includes("?") ? "&" : "?"}card=${outcome}`;
    const started = await driver.startCardSetup({
      idempotencyKey: `${SETUP_PREFIX}:${setupId}`,
      customerRef: customer.value,
      reference: `${SETUP_PREFIX}:${setupId}`,
      currency: owner.region === "AU" ? "AUD" : "IDR",
      successUrl: back("saved"),
      cancelUrl: back("cancelled"),
      locale: checkoutLocale(owner.region),
    });
    if (started.isErr()) return err(started.error);
    if (started.value.kind === "redirect") {
      await this.accounts.attachSetupCheckout(setupId, started.value.checkoutReference);
      return ok({ kind: "redirect", checkoutUrl: started.value.url });
    }
    const stored = {
      customerRef: customer.value,
      paymentMethodRef: started.value.paymentMethodRef,
      card: started.value.card,
    };
    await this.accounts.replaceCard(owner, driver.provider, stored);
    await this.accounts.finishSetup(setupId, "saved", null);
    return ok({ kind: "saved", card: stored.card });
  }

  /** Setup checkouts finishing or lapsing. Purchases are billing's; events that are not a setup are ignored. */
  registerHandlers(handlers: PaymentEventHandlers): void {
    handlers.on("checkout.completed", (event) =>
      event.mode === "setup" ? this.onSetupCompleted(event) : Promise.resolve(),
    );
    handlers.on("checkout.expired", async (event) => {
      const setup = await this.accounts.findSetup(
        event.checkoutReference,
        referenceId(event.reference, SETUP_PREFIX),
      );
      if (setup !== null)
        await this.accounts.finishSetup(setup.id, "expired", event.checkoutReference);
    });
  }

  private async onSetupCompleted(
    event: Extract<PaymentEvent, { type: "checkout.completed" }>,
  ): Promise<void> {
    const setup = await this.accounts.findSetup(
      event.checkoutReference,
      referenceId(event.reference, SETUP_PREFIX),
    );
    if (setup === null || setup.status === "saved") return;
    const result = await this.providers[setup.owner.region].payments.cardSetupResult(
      event.checkoutReference,
    );
    if (result.isErr()) throw new Error(`card setup ${setup.id}: ${result.error.detail}`);
    const customer = await this.accounts.findCustomer(setup.owner, setup.provider);
    if (customer !== result.value.customerRef) {
      // Never attach another customer's card to this owner.
      throw new Error(`card setup ${setup.id} saved a card for a different customer`);
    }
    await this.accounts.replaceCard(setup.owner, setup.provider, result.value);
    await this.accounts.finishSetup(setup.id, "saved", event.checkoutReference);
  }
}
