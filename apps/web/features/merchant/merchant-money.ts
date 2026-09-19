import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import type { MerchantCurrency } from "./merchant-device";

/**
 * `formatMoney`'s first parameter is branded `IdrMinorUnits`
 * (`@yourtal/contracts/money/money-format.ts`) even though it formats both
 * currencies — there is no currency-generic minor-units brand yet
 * (`packages/contracts` has no Fowler Money type; see that file's own doc
 * comment on the gap). Every amount reaching this feature's display layer
 * is a plain, already-trusted number this feature's own redemption logic
 * computed — never raw, unvalidated user input reaching the value path —
 * so `asDisplayIdr`, the unchecked display-only brand `money-format.ts`
 * itself provides for exactly this situation, is the correct escape hatch
 * here, never a value import of the real Zod-backed `toIdrMinorUnits`
 * (which would also drag Zod into the client bundle).
 *
 * One small wrapper, used everywhere this feature formats an amount, so
 * there is exactly one place carrying that justification instead of one
 * per call site.
 */
export function formatMerchantMoney(amountMinor: number, currency: MerchantCurrency): string {
  return formatMoney(asDisplayIdr(amountMinor), currency);
}
