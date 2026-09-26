import { formatMerchantMoney } from "./merchant-money";
import { getMerchantTranslator } from "./merchant-i18n";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

export interface MerchantErrorCopy {
  heading: string;
  body: string;
}

function formatDateTime(iso: string, locale: MerchantLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Plain-language copy, in the device's own locale, for every reason a
 * redemption can be blocked (this ticket's brief: "'Invalid' alone is
 * useless — a customer is standing there"). Every message says what
 * happened AND what the cashier should do next, never just a status word.
 * Exhaustive `switch` with a `never` default (docs/13b §4): a new
 * `MerchantRedemptionError` variant without a matching `merchant.error.*`
 * case fails the build.
 *
 * Money is formatted via `formatMerchantMoney` (`merchant-money.ts`), a
 * thin wrapper around `@yourtal/contracts/money/format`'s `formatMoney` —
 * safe in client code by design (that module is kept dependency-free
 * specifically so client components can format without paying for Zod).
 * `currency` is resolved once, server-side, in `merchant-data.ts`; this
 * function never imports the region contract.
 */
export function errorCopyFor(
  error: MerchantRedemptionError,
  locale: MerchantLocale,
  currency: MerchantCurrency,
): MerchantErrorCopy {
  const t = getMerchantTranslator(locale);
  switch (error.type) {
    case "voucher_not_found":
      return {
        heading: t("error.voucherNotFound.heading"),
        body: t("error.voucherNotFound.body"),
      };
    case "already_redeemed":
      return {
        heading: t("error.alreadyRedeemed.heading"),
        body: t("error.alreadyRedeemed.body"),
      };
    case "expired":
      return {
        heading: t("error.expired.heading"),
        body: t("error.expired.body", { date: formatDateTime(error.expiresAt, locale) }),
      };
    case "wrong_merchant":
      return {
        heading: t("error.wrongMerchant.heading"),
        body: t("error.wrongMerchant.body", {
          voucherMerchantName: error.voucherMerchantName,
          deviceMerchantName: error.deviceMerchantName,
        }),
      };
    case "amount_not_positive":
      return {
        heading: t("error.amountNotPositive.heading"),
        body: t("error.amountNotPositive.body"),
      };
    case "amount_exceeds_remaining_value":
      return {
        heading: t("error.amountExceedsRemainingValue.heading"),
        body: t("error.amountExceedsRemainingValue.body", {
          remaining: formatMerchantMoney(error.remainingValueMinor, currency),
        }),
      };
    case "requires_full_value_redemption":
      return {
        heading: t("error.requiresFullValueRedemption.heading"),
        body: t("error.requiresFullValueRedemption.body", {
          remaining: formatMerchantMoney(error.remainingValueMinor, currency),
        }),
      };
    case "network_error":
      return {
        heading: t("error.networkError.heading"),
        body: t("error.networkError.body"),
      };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
