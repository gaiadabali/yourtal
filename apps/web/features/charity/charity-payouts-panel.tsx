import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { Notice } from "@yourtal/ui/notice";
import type { CharityPayouts } from "@yourtal/contracts/billing/payouts";
import { startCharityPayoutLinkAction } from "./charity-payouts-action";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 5.2: the account auction proceeds are paid to. Absent outside Australia, where there are no payouts. */
export function CharityPayoutsPanel({
  charityId,
  payouts,
  t,
}: {
  charityId: string;
  payouts: CharityPayouts;
  t: Translate;
}) {
  const { account } = payouts;
  if (!account.available) return null;
  const ready = account.state === "ready";
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("console.payouts.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-body font-sans text-fg">
          {ready && account.bankLast4 !== null
            ? t("console.payouts.ready", { last4: account.bankLast4 })
            : t("console.payouts.intro")}
        </p>
        {ready ? null : (
          <p className="text-body-sm font-sans text-fg-muted">
            {t("console.payouts.auctionsNeed")}
          </p>
        )}
        <form action={startCharityPayoutLinkAction}>
          <input type="hidden" name="charityId" value={charityId} />
          <Button type="submit" variant={ready ? "secondary" : "primary"}>
            {ready
              ? t("console.payouts.update")
              : account.state === "in_progress"
                ? t("console.payouts.finish")
                : t("console.payouts.setUp")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** After the processor's page: details being checked, ready, or the page could not open. */
export function CharityPayoutsNotice({
  outcome,
  payouts,
  t,
}: {
  outcome: string | undefined;
  payouts: CharityPayouts;
  t: Translate;
}) {
  if (outcome === "returned") {
    return payouts.account.state === "ready" ? (
      <Notice tone="success">{t("console.payouts.returnedReady")}</Notice>
    ) : (
      <Notice tone="info">{t("console.payouts.returnedChecking")}</Notice>
    );
  }
  if (outcome === "error") return <Notice tone="danger">{t("console.payouts.error")}</Notice>;
  return null;
}
