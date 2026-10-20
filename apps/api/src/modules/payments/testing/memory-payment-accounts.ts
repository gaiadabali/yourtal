import { randomUUID } from "node:crypto";
import type {
  CardSetupRow,
  PaymentOwner,
  Provider,
  StoredCard,
} from "../payment-accounts.repository";
import type { PaymentAccountsStore } from "../payment-accounts.service";

const ownerKey = (owner: PaymentOwner, provider: Provider) =>
  `${owner.kind}:${owner.id}:${provider}`;

/** The accounts repository in memory, for unit tests. Same rules: one live card, conditional updates. */
export function memoryPaymentAccounts(): PaymentAccountsStore & {
  readonly cards: Map<string, StoredCard[]>;
  readonly setups: Map<string, CardSetupRow>;
} {
  const customers = new Map<string, string>();
  const cards = new Map<string, StoredCard[]>();
  const setups = new Map<string, CardSetupRow>();
  return {
    cards,
    setups,
    findCustomer: (owner, provider) =>
      Promise.resolve(customers.get(ownerKey(owner, provider)) ?? null),
    saveCustomer: (owner, provider, ref) => {
      const key = ownerKey(owner, provider);
      if (!customers.has(key)) customers.set(key, ref);
      return Promise.resolve(customers.get(key) ?? ref);
    },
    liveCard: (owner, provider) =>
      Promise.resolve(cards.get(ownerKey(owner, provider))?.at(-1) ?? null),
    replaceCard: (owner, provider, stored) => {
      const list = cards.get(ownerKey(owner, provider)) ?? [];
      if (list.at(-1)?.paymentMethodRef !== stored.paymentMethodRef) list.push(stored);
      cards.set(ownerKey(owner, provider), list);
      return Promise.resolve();
    },
    createSetup: (owner, provider) => {
      const id = randomUUID();
      setups.set(id, { id, owner, provider, checkoutRef: null, status: "pending" });
      return Promise.resolve(id);
    },
    attachSetupCheckout: (id, checkoutRef) => {
      const setup = setups.get(id);
      if (setup?.checkoutRef === null) setups.set(id, { ...setup, checkoutRef });
      return Promise.resolve();
    },
    findSetup: (checkoutRef, setupId) => {
      const found = [...setups.values()].find(
        (s) => s.checkoutRef === checkoutRef || (s.id === setupId && s.checkoutRef === null),
      );
      return Promise.resolve(found ?? null);
    },
    finishSetup: (id, status, checkoutRef) => {
      const setup = setups.get(id);
      if (setup?.status === "pending") {
        setups.set(id, { ...setup, status, checkoutRef: setup.checkoutRef ?? checkoutRef });
      }
      return Promise.resolve();
    },
  };
}
