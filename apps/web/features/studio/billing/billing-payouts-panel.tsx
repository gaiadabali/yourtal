import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { Notice } from "@yourtal/ui/notice";
import type { StudioPayouts } from "@yourtal/contracts/billing/payouts";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { startPayoutLinkAction } from "./payouts-action";

/**
 * 5.2: where approved statements are paid. Only Australia has payouts, so
 * the panel is absent elsewhere. The bank details are entered on the
 * processor's page; only the last four digits ever reach this one.
 */
export function BillingPayoutsPanel({
  businessId,
  payouts,
  canEdit,
  locale,
}: {
  businessId: string;
  payouts: StudioPayouts;
  canEdit: boolean;
  locale: SupportedLocale;
}) {
  const { account } = payouts;
  if (!account.available) return null;
  const t = getStudioTranslator(locale);
  const ready = account.state === "ready";
  const failed = payouts.payoutFailed;
  // A failed payout asks for new details; a ready account can still change them.
  const action =
    account.state === "not_started"
      ? { label: t("billing.payoutsSetUp"), primary: true }
      : account.state === "in_progress"
        ? { label: t("billing.payoutsFinish"), primary: true }
        : { label: t("billing.payoutsUpdate"), primary: failed };
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("billing.payoutsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failed ? <Notice tone="danger">{t("billing.payoutsFailed")}</Notice> : null}
        {payouts.waitingForAccount && !ready ? (
          <Notice tone="warning">{t("billing.payoutsWaiting")}</Notice>
        ) : null}
        <p className="text-body font-sans text-fg">
          {ready && account.bankLast4 !== null
            ? t("billing.payoutsReady", { last4: account.bankLast4 })
            : t("billing.payoutsIntro")}
        </p>
        {canEdit ? (
          <form action={startPayoutLinkAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <Button type="submit" variant={action.primary ? "primary" : "secondary"}>
              {action.label}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** After the processor's page: details being checked, or the account is ready. Or the page could not open. */
export function PayoutsReturnNotice({
  outcome,
  payouts,
  locale,
}: {
  outcome: string | undefined;
  payouts: StudioPayouts;
  locale: SupportedLocale;
}) {
  const t = getStudioTranslator(locale);
  if (outcome === "returned") {
    return payouts.account.state === "ready" ? (
      <Notice tone="success">{t("billing.payoutsReturnedReady")}</Notice>
    ) : (
      <Notice tone="info">{t("billing.payoutsReturnedChecking")}</Notice>
    );
  }
  if (outcome === "error") return <Notice tone="danger">{t("billing.payoutsError")}</Notice>;
  return null;
}
