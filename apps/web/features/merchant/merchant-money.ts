import type { Currency } from "@yourtal/contracts/money/currency";
import { formatMoneyAmount } from "@yourtal/ui/money-amount";
import type { MerchantLocale } from "./merchant-device";

/**
 * One wrapper for every amount this feature shows: the amount is in the
 * voucher's own currency, and the digits and symbol follow the device's
 * language, so an AUD amount never reads as "$45.00" inside Indonesian
 * prose. Every amount reaching here is a plain number this feature's own
 * redemption logic computed.
 */
export function formatMerchantMoney(
  amountMinor: number,
  currency: Currency,
  locale: MerchantLocale,
): string {
  return formatMoneyAmount(amountMinor, currency, locale);
}
