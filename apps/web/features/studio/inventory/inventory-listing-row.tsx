import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { getStudioTranslator, type SupportedLocale } from "../studio-i18n";
import { TagChips } from "../tag-picker";
import { ListingTagsEditor } from "./listing-tags-editor";
import { SettlementValueDialog } from "./settlement-value-dialog";

const STATUS_VARIANT = {
  available: "success",
  sold_out: "danger",
  expiring_soon: "warning",
  new: "secondary",
} as const;

export interface InventoryListingRowProps {
  businessId: string;
  listing: Listing;
  canEdit: boolean;
  locale: SupportedLocale;
}

/** One listing: what it is worth, what the business is paid, and the points price the platform computed. */
export function InventoryListingRow({
  businessId,
  listing,
  canEdit,
  locale,
}: InventoryListingRowProps) {
  const t = getStudioTranslator(locale);
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(listing.expiresAt),
  );
  return (
    <li className="flex flex-col gap-3 rounded-control border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-sans text-fg">{listing.title}</span>
        <Badge variant={STATUS_VARIANT[listing.status]}>
          {t(`inventory.status.${listing.status}`)}
        </Badge>
        {listing.transferable ? (
          <Badge variant="secondary">{t("inventory.transferableBadge")}</Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm font-sans sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-muted">{t("inventory.row.faceValue")}</dt>
          <dd>
            <MoneyAmount
              amountMinor={listing.faceValueMinor}
              currency={listing.currency}
              locale={locale}
            />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-muted">{t("inventory.row.settlement")}</dt>
          <dd>
            <MoneyAmount
              amountMinor={listing.settlementValueMinor}
              currency={listing.currency}
              locale={locale}
            />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-muted">
            {t("inventory.row.price")} · {t("inventory.row.priceNote")}
          </dt>
          <dd>
            <PointsChip
              value={listing.priceInPoints}
              size="sm"
              locale={locale}
              formatLabel={(formatted) => t("billing.points", { formatted })}
            />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-muted">{t("inventory.row.expires")}</dt>
          <dd>{expires}</dd>
        </div>
      </dl>
      <p className="text-body-sm font-sans text-fg-muted">
        {t("inventory.stock", {
          remaining: listing.stockRemaining,
          total: listing.stockTotal,
          locations: listing.locations.length,
        })}{" "}
        · {t(`inventory.row.channel.${listing.channel}`)}
      </p>
      <TagChips tags={listing.tags} />
      {canEdit ? (
        <div className="flex flex-wrap items-start gap-2">
          <SettlementValueDialog
            businessId={businessId}
            listingId={listing.id}
            listingTitle={listing.title}
            currency={listing.currency}
            settlementValueMinor={listing.settlementValueMinor}
            priceInPoints={listing.priceInPoints}
          />
          <ListingTagsEditor
            businessId={businessId}
            listingId={listing.id}
            listingTitle={listing.title}
            contentCategory={listing.contentCategory}
            tags={listing.tags}
            transferable={listing.transferable}
          />
        </div>
      ) : null}
    </li>
  );
}
