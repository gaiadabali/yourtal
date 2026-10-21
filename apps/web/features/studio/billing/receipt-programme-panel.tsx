import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { Notice } from "@yourtal/ui/notice";
import { PointsChip } from "@yourtal/ui/points-chip";
import type { PointPackage, ReceiptProgrammeView } from "@yourtal/contracts/billing";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { purchasePointsAction } from "./purchase-points-action";

const KNOWN_TIERS: ReadonlySet<string> = new Set(["starter", "grow", "scale"]);
const CARD = "flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4";

export interface ReceiptProgrammePanelProps {
  businessId: string;
  /** `GET .../billing/receipt-programme`; null (a 404 `not_a_receipt_funder`) renders nothing. */
  programme: ReceiptProgrammeView | null;
  canPurchase: boolean;
  /** The page's once-per-render key; the action adds the programme and tier to it. */
  idempotencyKey: string;
  locale: SupportedLocale;
}

/**
 * 2.10.b (F127, docs/27 3.5): the receipt funder's panel. Only the business
 * that funds a partner's receipts sees it; it shows whether receipts are
 * earning, the room left, and the receipt packages (priced by the server, GST
 * on top) that refill it. Each package buys through the same action and
 * checkout as an ordinary one, with `programme=receipts`.
 */
export function ReceiptProgrammePanel({
  businessId,
  programme,
  canPurchase,
  idempotencyKey,
  locale,
}: ReceiptProgrammePanelProps) {
  if (programme === null) return null;
  const t = getStudioTranslator(locale);
  return (
    <Card data-testid="receipt-programme-panel">
      <CardHeader>
        <CardTitle as="h2">{t("billing.receiptTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-body-sm text-fg-muted">{t("billing.receiptIntro")}</p>
        <Notice
          tone={programme.earning ? "success" : "warning"}
          title={t(programme.earning ? "billing.receiptEarning" : "billing.receiptPaused")}
        >
          {programme.earning ? null : <p>{t("billing.receiptPausedHint")}</p>}
        </Notice>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PointsChip
            value={programme.remainingPoints}
            locale={locale}
            size="lg"
            formatLabel={(formatted) => t("billing.receiptRemaining", { formatted })}
          />
          <span aria-hidden="true" className="text-body-sm text-fg-muted">
            {t("billing.receiptLeftSuffix")}
          </span>
          <span className="text-body-sm text-fg-muted">
            {t("billing.receiptPerReceipt", { count: programme.pointsPerReceipt })}
          </span>
        </div>
        <section aria-labelledby="receipt-packages-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="receipt-packages-title" className="text-title font-sans font-semibold text-fg">
              {t("billing.receiptPackagesTitle")}
            </h3>
            <Badge variant="secondary">{t("billing.receiptPackagesNote")}</Badge>
          </div>
          {programme.packages.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{t("billing.receiptPackagesNone")}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
              {programme.packages.map((pkg) => (
                <li key={pkg.tierKey} className={CARD}>
                  <ReceiptPackageCard
                    pkg={pkg}
                    businessId={businessId}
                    canPurchase={canPurchase}
                    idempotencyKey={idempotencyKey}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ReceiptPackageCard({
  pkg,
  businessId,
  canPurchase,
  idempotencyKey,
  locale,
}: {
  pkg: PointPackage;
  businessId: string;
  canPurchase: boolean;
  idempotencyKey: string;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  const tier = KNOWN_TIERS.has(pkg.tierKey)
    ? t(`billing.tier.${pkg.tierKey}`)
    : t("billing.tierFallback");
  const money = (amountMinor: number) => (
    <MoneyAmount amountMinor={amountMinor} currency={pkg.currency} locale={locale} />
  );
  return (
    <>
      <span className="text-title font-sans font-semibold text-fg">{tier}</span>
      <div>
        <PointsChip
          value={pkg.points}
          locale={locale}
          formatLabel={(formatted) => t("billing.points", { formatted })}
        />
      </div>
      {/* F118: ex-GST price, the GST on top, then the total. No tax line where none applies. */}
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
      {canPurchase ? (
        <form action={purchasePointsAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="currency" value={pkg.currency} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="programme" value="receipts" />
          <input type="hidden" name="tierKey" value={pkg.tierKey} />
          <Button type="submit" aria-label={t("billing.receiptBuyNamed", { tier })}>
            {t("billing.receiptBuy")}
          </Button>
        </form>
      ) : null}
    </>
  );
}
