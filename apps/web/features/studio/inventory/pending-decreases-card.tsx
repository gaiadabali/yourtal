import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { ApproveDecreaseButton } from "./approve-decrease-button";
import type { SettlementDecreaseRequest } from "./inventory-data";

export interface PendingDecreasesCardProps {
  businessId: string;
  requests: readonly SettlementDecreaseRequest[];
  listings: readonly Listing[];
  /** Owner or admin: the roles the policy lets approve a cut. */
  canApprove: boolean;
  currentUserId: string;
  locale: SupportedLocale;
}

/** Cuts to S waiting for a second person. The requester sees why they cannot approve their own. */
export function PendingDecreasesCard({
  businessId,
  requests,
  listings,
  canApprove,
  currentUserId,
  locale,
}: PendingDecreasesCardProps) {
  const t = getStudioTranslator(locale);
  const titleById = new Map(listings.map((listing) => [listing.id, listing.title]));
  if (requests.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("inventory.pendingDecreasesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {requests.map((request) => {
          const title = titleById.get(request.listingId) ?? request.listingId;
          const mine = request.requestedBy === currentUserId;
          return (
            <div
              key={request.id}
              className="flex flex-col gap-2 rounded-control border border-border-subtle p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body-sm font-sans text-fg">{title}</span>
                <span className="text-body-sm font-sans text-fg-muted">
                  <MoneyAmount
                    amountMinor={request.currentSettlementValueMinor}
                    currency={request.currency}
                    locale={locale}
                  />{" "}
                  →{" "}
                  <MoneyAmount
                    amountMinor={request.proposedSettlementValueMinor}
                    currency={request.currency}
                    locale={locale}
                  />
                </span>
                <Badge variant="warning">{t("inventory.awaitingSecondApproval")}</Badge>
              </div>
              <p className="text-body-sm font-sans text-fg-muted">
                {mine
                  ? t("inventory.approval.requestedByYou")
                  : t("inventory.approval.requestedByTeammate")}
                {request.reason === null
                  ? ""
                  : ` · ${t("inventory.approval.reason", { reason: request.reason })}`}
              </p>
              {canApprove && !mine ? (
                <ApproveDecreaseButton
                  businessId={businessId}
                  listingId={request.listingId}
                  requestId={request.id}
                  listingTitle={title}
                />
              ) : (
                <p className="text-body-sm font-sans text-fg-muted">
                  {canApprove
                    ? t("inventory.approval.selfRequested")
                    : t("inventory.approval.needsOwner")}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
