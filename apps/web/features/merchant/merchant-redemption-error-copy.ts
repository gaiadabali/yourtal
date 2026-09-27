import type { Currency } from "@yourtal/contracts/money/currency";
import { formatMerchantMoney } from "./merchant-money";
import { getMerchantTranslator } from "./merchant-i18n";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { MerchantLocale } from "./merchant-device";

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
 * redemption can be blocked. Keyed by `error.code` rather than an
 * exhaustive switch (see `merchant-redemption-errors.ts`'s doc comment for
 * why: most codes now come from the server, which this feature cannot
 * enumerate at compile time) — an unrecognised code falls back to the
 * server's own `message` (or a generic network-error copy if there is
 * none), never a blank screen.
 */
export function errorCopyFor(
  error: MerchantRedemptionError,
  locale: MerchantLocale,
  currency: Currency,
): MerchantErrorCopy {
  const t = getMerchantTranslator(locale);
  switch (error.code) {
    case "voucher_not_found":
      return { heading: t("error.voucherNotFound.heading"), body: t("error.voucherNotFound.body") };
    case "already_redeemed":
      return {
        heading: t("error.alreadyRedeemed.heading"),
        body: t("error.alreadyRedeemed.body"),
      };
    case "expired":
      return {
        heading: t("error.expired.heading"),
        body: t("error.expired.body", {
          date: formatDateTime(error.expiresAt ?? new Date().toISOString(), locale),
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
          remaining: formatMerchantMoney(error.remainingValueMinor ?? 0, currency),
        }),
      };
    case "requires_full_value_redemption":
      return {
        heading: t("error.requiresFullValueRedemption.heading"),
        body: t("error.requiresFullValueRedemption.body", {
          remaining: formatMerchantMoney(error.remainingValueMinor ?? 0, currency),
        }),
      };
    case "network_error":
      return { heading: t("error.networkError.heading"), body: t("error.networkError.body") };
    default:
      return {
        heading: t("error.networkError.heading"),
        body: error.fallbackMessage ?? t("error.networkError.body"),
      };
  }
}
