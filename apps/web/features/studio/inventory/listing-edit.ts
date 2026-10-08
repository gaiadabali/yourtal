import { expiryInstant } from "./listing-form";

/** What the edit dialog holds as typed text. */
export interface ListingEditValues {
  title: string;
  stockTotal: string;
  /** `yyyy-mm-dd`, the last day the voucher can be used. */
  expiresOn: string;
}

export type ListingEditField = keyof ListingEditValues;
/** Keys under `studio.inventory.form.error` (the create form's own wording, reused). */
export type ListingEditErrorKey = "required" | "stock" | "expiry";
export type ListingEditErrors = Partial<Record<ListingEditField, ListingEditErrorKey>>;

/** The only fields a plain edit may send; price and settlement value have their own routes. */
export interface ListingEditPatch {
  title?: string;
  stockTotal?: number;
  expiresAt?: string;
}

export interface ListingEditOriginal {
  title: string;
  stockTotal: number;
  expiresAt: string;
}

/** The browser-local calendar day of an instant, as `yyyy-mm-dd`. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export function editValuesFor(listing: ListingEditOriginal): ListingEditValues {
  return {
    title: listing.title,
    stockTotal: String(listing.stockTotal),
    expiresOn: localDay(listing.expiresAt),
  };
}

/**
 * Only what changed is sent, so an untouched date is never re-stamped to end-of-day and an
 * untouched title is never rewritten. `unchanged` means there is nothing to save.
 */
export function buildListingEditPatch(
  values: ListingEditValues,
  original: ListingEditOriginal,
  now: Date,
):
  | { ok: true; patch: ListingEditPatch }
  | { ok: false; errors: ListingEditErrors; unchanged: boolean } {
  const errors: ListingEditErrors = {};
  const patch: ListingEditPatch = {};

  const title = values.title.trim();
  if (title === "" || title.length > 140) errors.title = "required";
  else if (title !== original.title) patch.title = title;

  const stockText = values.stockTotal.trim();
  const stock = /^\d{1,9}$/.test(stockText) ? Number(stockText) : 0;
  if (stock < 1) errors.stockTotal = "stock";
  else if (stock !== original.stockTotal) patch.stockTotal = stock;

  if (values.expiresOn !== localDay(original.expiresAt)) {
    const expiresAt = expiryInstant(values.expiresOn, now);
    if (expiresAt === null) errors.expiresOn = "expiry";
    else patch.expiresAt = expiresAt;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, unchanged: false };
  if (Object.keys(patch).length === 0) return { ok: false, errors, unchanged: true };
  return { ok: true, patch };
}
