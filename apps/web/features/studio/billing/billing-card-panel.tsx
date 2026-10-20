import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { BillingCard } from "@yourtal/contracts/billing";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { CARD_PANEL_ID } from "./billing-anchors";
import { startCardSetupAction } from "./purchase-points-action";

const BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
};

/**
 * 5.1.a: the card boosts are charged to, where boosts need one (AU on
 * Stripe). Only brand, last four digits and expiry ever reach this page.
 */
export function BillingCardPanel({
  businessId,
  card,
  canEdit,
  locale,
}: {
  businessId: string;
  card: BillingCard;
  canEdit: boolean;
  locale: SupportedLocale;
}) {
  if (!card.required) return null;
  const t = getStudioTranslator(locale);
  const saved = card.card;
  return (
    <Card id={CARD_PANEL_ID}>
      <CardHeader>
        <CardTitle as="h2">{t("billing.cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-body-sm font-sans text-fg-muted">{t("billing.cardIntro")}</p>
        <p className="text-body font-sans text-fg">
          {saved === null
            ? t("billing.cardNone")
            : t("billing.cardSaved", {
                brand: BRAND[saved.brand] ?? saved.brand,
                last4: saved.last4,
                month: String(saved.expMonth).padStart(2, "0"),
                year: String(saved.expYear).slice(-2),
              })}
        </p>
        {canEdit ? (
          <form action={startCardSetupAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <Button type="submit" variant={saved === null ? "primary" : "secondary"}>
              {saved === null ? t("billing.cardAdd") : t("billing.cardReplace")}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
