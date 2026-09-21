import type { ListingStatus } from "@yourtal/contracts/listing";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

/**
 * Maps a listing's `status` (docs/09 §4.1's catalogue states) to how it is
 * badged (YT-0420 acceptance: "Sold-out, expiring and newly-added states
 * designed"). `available` is deliberately unbadged — a badge on every
 * single card would just be noise; the three states worth calling out are
 * exactly the three the acceptance criteria names.
 */
export type StoreStatusBadgeVariant = "danger" | "warning" | "success";

export interface StoreStatusPresentation {
  label: string;
  badgeVariant: StoreStatusBadgeVariant;
}

/**
 * Returns the badge to show for a listing's status, or `null` for the
 * unbadged `available` state. YT-0405: `locale` is required, not defaulted
 * — see `campaign-card.tsx`'s report for why an optional prop that
 * silently defaults to `id-ID` is treated as a bug in this ticket. A plain
 * `switch` (rather than a lookup table keyed by a dynamic string) so each
 * message key stays a literal `t()` can type-check against the real
 * `store` catalogue shape.
 */
export function listingStatusPresentation(
  status: ListingStatus,
  locale: SupportedLocale,
): StoreStatusPresentation | null {
  const t = getStoreTranslator(locale);
  switch (status) {
    case "sold_out":
      return { label: t("status.soldOut"), badgeVariant: "danger" };
    case "expiring_soon":
      return { label: t("status.expiringSoon"), badgeVariant: "warning" };
    case "new":
      return { label: t("status.new"), badgeVariant: "success" };
    default:
      return null;
  }
}
