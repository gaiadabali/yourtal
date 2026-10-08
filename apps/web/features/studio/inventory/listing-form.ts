import type { ListingChannel } from "@yourtal/contracts/listing/listing-values";
import { minorFromInput } from "../boost/money-input";

/** Zod-free restatements of the listing contract's enums, so client forms stay light (see `studio-roles.ts`). */
export const LISTING_CATEGORY_OPTIONS = [
  "food_beverage",
  "retail",
  "digital_goods",
  "merchandise",
  "services",
] as const;
export const LISTING_CHANNEL_OPTIONS = [
  "in_store",
  "online",
  "both",
] as const satisfies readonly ListingChannel[];
export const PARTIAL_POLICY_OPTIONS = [
  "single_use_forfeit",
  "balance_carrying",
  "minimum_spend",
] as const;

export type PartialPolicy = (typeof PARTIAL_POLICY_OPTIONS)[number];
export type Currency = "AUD" | "IDR";

/** What the form holds as typed text; nothing here is a number until `buildNewListingBody` converts it. */
export interface ListingFormValues {
  title: string;
  description: string;
  imageUrl: string;
  category: (typeof LISTING_CATEGORY_OPTIONS)[number];
  contentCategory: string;
  audience: string;
  tags: string[];
  faceValue: string;
  settlementValue: string;
  stockTotal: string;
  locationIds: string[];
  channel: ListingChannel;
  transferable: boolean;
  partialPolicy: PartialPolicy;
  minimumSpend: string;
  /** `yyyy-mm-dd`, the last day the voucher can be used. */
  expiresOn: string;
}

export type ListingFormField =
  | "title"
  | "description"
  | "imageUrl"
  | "faceValue"
  | "settlementValue"
  | "stockTotal"
  | "locationIds"
  | "minimumSpend"
  | "expiresOn";
/** Keys under `studio.inventory.form.error`. */
export type ListingFormErrorKey =
  "required" | "amount" | "settlementAboveFace" | "stock" | "locations" | "image" | "expiry";
export type ListingFormErrors = Partial<Record<ListingFormField, ListingFormErrorKey>>;

/** The body of `POST /api/:tenantId/store/listings`. No price: the server computes it. */
export interface NewListingBody {
  merchantName: string;
  title: string;
  description: string;
  category: string;
  locationIds: string[];
  faceValueMinor: number;
  settlementValueMinor: number;
  stockTotal: number;
  transferable: boolean;
  partialRedemptionPolicy: PartialPolicy;
  minimumSpendMinor: number | null;
  expiresAt: string;
  status: "available";
  audience: string;
  contentCategory: string;
  tags: string[];
  imageUrl: string;
  channel: ListingChannel;
  partialRedemption: "single_use" | "balance_carries";
}

export function emptyListingValues(): ListingFormValues {
  return {
    title: "",
    description: "",
    imageUrl: "",
    category: "food_beverage",
    contentCategory: "food-and-drink",
    audience: "all_ages",
    tags: [],
    faceValue: "",
    settlementValue: "",
    stockTotal: "",
    locationIds: [],
    channel: "in_store",
    transferable: false,
    partialPolicy: "single_use_forfeit",
    minimumSpend: "",
    expiresOn: "",
  };
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** End of the chosen day in the browser's own time zone, as an ISO instant; `null` if unreadable or already past. */
export function expiryInstant(expiresOn: string, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null;
  const end = new Date(`${expiresOn}T23:59:59`);
  return Number.isNaN(end.getTime()) || end.getTime() <= now.getTime() ? null : end.toISOString();
}

/**
 * Typed amounts become exact integer minor units (AUD cents, whole rupiah) with
 * no floating point. The same limits the API enforces are checked here only to
 * save a round trip; the server is the authority.
 */
export function buildNewListingBody(
  values: ListingFormValues,
  context: { currency: Currency; merchantName: string; now: Date },
): { ok: true; body: NewListingBody } | { ok: false; errors: ListingFormErrors } {
  const errors: ListingFormErrors = {};
  const title = values.title.trim();
  const description = values.description.trim();
  if (title === "" || title.length > 140) errors.title = "required";
  if (description === "" || description.length > 500) errors.description = "required";
  if (!isHttpUrl(values.imageUrl.trim())) errors.imageUrl = "image";

  const face = minorFromInput(values.faceValue, context.currency);
  const settlement = minorFromInput(values.settlementValue, context.currency);
  if (face === null) errors.faceValue = "amount";
  if (settlement === null) errors.settlementValue = "amount";
  else if (face !== null && settlement > face) errors.settlementValue = "settlementAboveFace";

  const stockText = values.stockTotal.trim();
  const stock = /^\d{1,9}$/.test(stockText) ? Number(stockText) : 0;
  if (stock < 1) errors.stockTotal = "stock";
  if (values.locationIds.length === 0) errors.locationIds = "locations";

  let minimumSpend: number | null = null;
  if (values.partialPolicy === "minimum_spend") {
    minimumSpend = minorFromInput(values.minimumSpend, context.currency);
    if (minimumSpend === null) errors.minimumSpend = "amount";
  }
  const expiresAt = expiryInstant(values.expiresOn, context.now);
  if (expiresAt === null) errors.expiresOn = "expiry";

  if (
    Object.keys(errors).length > 0 ||
    face === null ||
    settlement === null ||
    expiresAt === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    body: {
      merchantName: context.merchantName,
      title,
      description,
      category: values.category,
      locationIds: values.locationIds,
      faceValueMinor: face,
      settlementValueMinor: settlement,
      stockTotal: stock,
      transferable: values.transferable,
      partialRedemptionPolicy: values.partialPolicy,
      minimumSpendMinor: minimumSpend,
      expiresAt,
      status: "available",
      audience: values.audience,
      contentCategory: values.contentCategory,
      tags: values.tags,
      imageUrl: values.imageUrl.trim(),
      channel: values.channel,
      // The counter-facing wording of the same choice: only "balance carries" keeps a remainder.
      partialRedemption:
        values.partialPolicy === "balance_carrying" ? "balance_carries" : "single_use",
    },
  };
}
