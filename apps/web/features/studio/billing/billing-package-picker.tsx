import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import type { PointPackage } from "@yourtal/contracts/billing";
import { asDisplayIdr, formatMoney } from "@yourtal/contracts/money/format";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { purchasePointsAction } from "./purchase-points-action";

/** Tier keys with a translated display name; any other key the catalogue adds gets a generic label. */
const KNOWN_TIERS: ReadonlySet<string> = new Set(["starter", "grow", "scale"]);

const CARD = "relative flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4";
const NAME = "text-title font-sans font-semibold text-fg";

export interface BillingPackagePickerProps {
  businessId: string;
  /** Whatever `GET .../billing/packages` returned, smallest first; priced by the server. */
  packages: readonly PointPackage[];
  canPurchase: boolean;
  /** Minted once per render (`page.tsx`); the action appends the chosen tier. */
  idempotencyKey: string;
  locale: SupportedLocale;
}

/**
 * F121/F122: a business buys a package, never a free amount. Plain native
 * radios in one `<form>`, so it works without client JS: the chosen tier posts
 * as `tierKey` and the single Buy goes to the checkout. Someone who can view
 * Billing but not buy sees the same packages and prices, with no form.
 */
export function BillingPackagePicker({
  businessId,
  packages,
  canPurchase,
  idempotencyKey,
  locale,
}: BillingPackagePickerProps) {
  const t = getStudioTranslator(locale);
  const first = packages[0];
  if (!first) return <p className="text-body-sm text-fg-muted">{t("billing.packagesNone")}</p>;

  // Three side by side on desktop, stacked on a phone; more tiers just wrap.
  const grid = "grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]";

  if (!canPurchase) {
    return (
      <ul className={grid}>
        {packages.map((pkg) => (
          <li key={pkg.tierKey} className={CARD}>
            <span className={NAME}>{tierName(pkg.tierKey, t)}</span>
            <PackageDetails pkg={pkg} locale={locale} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form action={purchasePointsAction} className="flex flex-col gap-4">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="currency" value={first.currency} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{t("billing.packagesLegend")}</legend>
        <div className={grid}>
          {packages.map((pkg, index) => (
            <div
              key={pkg.tierKey}
              className={`${CARD} has-[:checked]:border-accent has-[:checked]:bg-accent-subtle has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus`}
            >
              <div className="flex items-center gap-3">
                {/* The Input primitive carries the accessible name (its label is hidden); the title beside it is the visible copy. */}
                <Input
                  type="radio"
                  id={`package-${pkg.tierKey}`}
                  name="tierKey"
                  value={pkg.tierKey}
                  defaultChecked={index === 0}
                  required
                  label={tierName(pkg.tierKey, t)}
                  hideLabel
                  aria-describedby={`package-${pkg.tierKey}-details`}
                  className="h-4 w-4 shrink-0 rounded-none border-0 bg-transparent p-0 accent-primary"
                />
                <span aria-hidden="true" className={NAME}>
                  {tierName(pkg.tierKey, t)}
                </span>
                {/* An empty label stretched over the card makes the whole card the click target. */}
                <label
                  htmlFor={`package-${pkg.tierKey}`}
                  className="absolute inset-0 cursor-pointer"
                />
              </div>
              <PackageDetails pkg={pkg} locale={locale} />
            </div>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit">{t("billing.buy")}</Button>
      </div>
    </form>
  );
}

function tierName(tierKey: string, t: ReturnType<typeof getStudioTranslator>): string {
  return KNOWN_TIERS.has(tierKey) ? t(`billing.tier.${tierKey}`) : t("billing.tierFallback");
}

function PackageDetails({ pkg, locale }: { pkg: PointPackage; locale: SupportedLocale }) {
  const t = getStudioTranslator(locale);
  const taxed = pkg.taxRateBps > 0;
  const money = (amountMinor: number) => formatMoney(asDisplayIdr(amountMinor), pkg.currency);
  return (
    <>
      <div id={`package-${pkg.tierKey}-details`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PointsChip
            value={pkg.points}
            locale={locale}
            formatLabel={(formatted) => t("billing.points", { formatted })}
          />
          {pkg.savingMinor > 0 ? (
            <Badge variant="success">
              {t(taxed ? "billing.savingExTax" : "billing.saving", {
                amount: money(pkg.savingMinor),
              })}
            </Badge>
          ) : null}
        </div>
        <p className="text-body-sm text-fg-muted">
          {t(taxed ? "billing.per1000ExTax" : "billing.per1000", {
            price: money(pkg.pricePer1000Minor),
          })}
        </p>
        <PriceBreakdown pkg={pkg} locale={locale} />
      </div>
    </>
  );
}

/** F118: the ex-GST price, the GST on top, and the total charged. No tax line where none applies. */
function PriceBreakdown({ pkg, locale }: { pkg: PointPackage; locale: SupportedLocale }) {
  const t = getStudioTranslator(locale);
  const money = (amountMinor: number) => (
    <MoneyAmount amountMinor={amountMinor} currency={pkg.currency} locale={locale} />
  );
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-body-sm font-sans text-fg-muted">
      {pkg.taxRateBps > 0 ? (
        <>
          <dt>{t("billing.subtotal")}</dt>
          <dd className="text-end">{money(pkg.subtotalMinor)}</dd>
          <dt>{t("billing.gst", { rate: pkg.taxRateBps / 100 })}</dt>
          <dd className="text-end">{money(pkg.taxMinor)}</dd>
        </>
      ) : null}
      <dt className="font-semibold text-fg">{t("billing.total")}</dt>
      <dd className="text-end font-semibold text-fg">{money(pkg.totalMinor)}</dd>
    </dl>
  );
}
