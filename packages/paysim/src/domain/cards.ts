import { ID_PREFIX, newId } from "../ids";
import type { Ctx } from "../ctx";
import { unix } from "../ctx";
import type { StoredObject } from "../store";
import { mk } from "./repo";

export type CardScenario = "ok" | "declined" | "threeds";

/** Stripe's test cards, and nothing else. Keyed by digits only. */
const TEST_CARDS: Record<string, CardScenario> = {
  "4242424242424242": "ok",
  "4000000000000002": "declined",
  "4000002500003155": "threeds",
};

/** Only brand, last4 and expiry ever leave the page handler. */
export interface CardInfo {
  brand: "visa";
  last4: string;
  expMonth: number;
  expYear: number;
}

export function classifyCard(digits: string): CardScenario | null {
  return TEST_CARDS[digits] ?? null;
}

export function cardInfo(digits: string, expMonth: number, expYear: number): CardInfo {
  return { brand: "visa", last4: digits.slice(-4), expMonth, expYear };
}

export function createPaymentMethod(
  ctx: Ctx,
  card: CardInfo,
  customer: string | null,
  account: string | null,
): StoredObject {
  const id = newId(ID_PREFIX.paymentMethod);
  return mk("payment_method", id, account, {
    id,
    object: "payment_method",
    created: unix(ctx.now),
    livemode: false,
    type: "card",
    customer,
    card: {
      brand: card.brand,
      last4: card.last4,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      country: "AU",
      funding: "credit",
    },
  });
}
