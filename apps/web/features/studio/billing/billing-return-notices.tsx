import { Notice } from "@yourtal/ui/notice";
import type { BillingCard, CardPurchase } from "@yourtal/contracts/billing";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { RefreshWhileWaiting } from "./refresh-while-waiting";

/**
 * 5.1.a: what the Billing page says when the processor's page sends the
 * browser back. The points (or the card) arrive with the webhook, so a
 * pending state refreshes itself until it lands.
 */
export function PurchaseReturnNotice({
  purchase,
  cancelled,
  locale,
}: {
  purchase: CardPurchase | null;
  cancelled: boolean;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  if (purchase === null) return null;
  switch (purchase.status) {
    case "paid":
      return <Notice tone="success">{t("billing.purchased")}</Notice>;
    case "needs_review":
      return <Notice tone="info">{t("billing.returnReview")}</Notice>;
    case "expired":
      return <Notice tone="warning">{t("billing.returnExpired")}</Notice>;
    case "pending":
      return cancelled ? (
        <Notice tone="warning">{t("billing.returnCancelled")}</Notice>
      ) : (
        <Notice tone="info" title={t("billing.returnWaitingTitle")}>
          <p>{t("billing.returnWaitingBody")}</p>
          <RefreshWhileWaiting stillWaiting={t("billing.returnStillWaiting")} />
        </Notice>
      );
    default:
      return null;
  }
}

/** After the card page: saved (perhaps still on its way from the webhook), cancelled or failed. */
export function CardReturnNotice({
  outcome,
  card,
  locale,
}: {
  outcome: string | undefined;
  card: BillingCard;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  if (outcome === "saved") {
    return card.card !== null ? (
      <Notice tone="success">{t("billing.cardAdded")}</Notice>
    ) : (
      <Notice tone="info">
        <p>{t("billing.cardSaving")}</p>
        <RefreshWhileWaiting stillWaiting={t("billing.returnStillWaiting")} />
      </Notice>
    );
  }
  if (outcome === "cancelled") return <Notice tone="warning">{t("billing.cardCancelled")}</Notice>;
  if (outcome === "failed") return <Notice tone="danger">{t("billing.cardFailed")}</Notice>;
  return null;
}
