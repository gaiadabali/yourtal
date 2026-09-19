import type { ListingStatus } from "@yourtal/contracts/listing";

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

const STATUS_PRESENTATION: Partial<Record<ListingStatus, StoreStatusPresentation>> = {
  sold_out: { label: "Habis", badgeVariant: "danger" },
  expiring_soon: { label: "Segera berakhir", badgeVariant: "warning" },
  new: { label: "Baru", badgeVariant: "success" },
};

/** Returns the badge to show for a listing's status, or `null` for the unbadged `available` state. */
export function listingStatusPresentation(status: ListingStatus): StoreStatusPresentation | null {
  return STATUS_PRESENTATION[status] ?? null;
}
