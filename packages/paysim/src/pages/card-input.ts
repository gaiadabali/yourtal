import { type CardInfo, classifyCard, cardInfo, type CardScenario } from "../domain/cards";
import type { StringKey } from "./strings";

export interface CardFormErrors {
  number?: StringKey;
  expiry?: StringKey;
  cvc?: StringKey;
}

export type CardCheck =
  { ok: true; scenario: CardScenario; card: CardInfo } | { ok: false; errors: CardFormErrors };

/** `MM / YY`, `MM/YY`, `MMYY` or a four-digit year. Valid through the month's end. */
function parseExpiry(raw: string, now: Date): { month: number; year: number } | StringKey {
  const m = /^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/.exec(raw.trim());
  if (m === null) return "expiryInvalid";
  const month = Number(m[1]);
  const yearRaw = Number(m[2]);
  const year = (m[2] ?? "").length === 2 ? 2000 + yearRaw : yearRaw;
  if (month < 1 || month > 12 || year > now.getUTCFullYear() + 50) return "expiryInvalid";
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (year * 12 + (month - 1) < nowIndex) return "expiryPast";
  return { month, year };
}

/**
 * Validates what the shopper typed. The digits exist only inside this call:
 * what comes out is the scenario plus brand, last4 and expiry.
 */
export function checkCard(
  fields: { number: string; expiry: string; cvc: string },
  now: Date,
): CardCheck {
  const errors: CardFormErrors = {};
  const digits = fields.number.replace(/[\s-]/g, "");
  let scenario: CardScenario | null = null;
  if (!/^\d{12,19}$/.test(digits)) {
    errors.number = "numberInvalid";
  } else {
    scenario = classifyCard(digits);
    if (scenario === null) errors.number = "testCardsOnly";
  }
  const expiry = parseExpiry(fields.expiry, now);
  if (typeof expiry === "string") errors.expiry = expiry;
  if (!/^\d{3}$/.test(fields.cvc.trim())) errors.cvc = "cvcInvalid";
  if (Object.keys(errors).length > 0 || scenario === null || typeof expiry === "string") {
    return { ok: false, errors };
  }
  return { ok: true, scenario, card: cardInfo(digits, expiry.month, expiry.year) };
}
