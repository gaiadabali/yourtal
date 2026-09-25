import * as React from "react";
import { cn } from "../cn";

export type Currency = "AUD" | "IDR";

/** Minor-unit exponent per currency (K6): AUD has cents, IDR has none. */
const EXPONENT: Record<Currency, number> = { AUD: 2, IDR: 0 };

export interface MoneyAmountProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Integer minor units (cents for AUD, whole rupiah for IDR). Never a float. */
  amountMinor: number;
  /** From the data the amount belongs to — never inferred from the viewer. */
  currency: Currency;
  /** Number formatting locale. Defaults to en-AU; pass the viewer's region locale. */
  locale?: string;
}

/**
 * Renders a money amount. The only arithmetic here is dividing by 10^exponent
 * to get the display value; every place value, symbol and grouping comes
 * from Intl.NumberFormat so it always matches the target locale's convention.
 */
export const MoneyAmount = React.forwardRef<HTMLSpanElement, MoneyAmountProps>(
  ({ amountMinor, currency, locale = "en-AU", className, ...props }, ref) => {
    const exponent = EXPONENT[currency];
    const value = amountMinor / 10 ** exponent;
    const formatted = React.useMemo(
      () =>
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          minimumFractionDigits: exponent,
          maximumFractionDigits: exponent,
        }).format(value),
      [locale, currency, exponent, value],
    );

    return (
      <span ref={ref} className={cn("text-numeric", className)} {...props}>
        {formatted}
      </span>
    );
  },
);
MoneyAmount.displayName = "MoneyAmount";
