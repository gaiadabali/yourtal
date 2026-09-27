import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";

/** 7.4.a: `store.merchant_location` CRUD. Today only the seed writes this table. */

export interface CreateLocationInput {
  readonly name: string;
  readonly address: string;
  readonly district: string;
}

/** Every field optional (a PATCH). */
export interface EditLocationInput {
  readonly name?: string | undefined;
  readonly address?: string | undefined;
  readonly district?: string | undefined;
}

export interface LocationRepository {
  listOwned(merchantId: string): Promise<MerchantLocation[]>;
  findOwnedById(merchantId: string, locationId: string): Promise<MerchantLocation | null>;
  create(merchantId: string, input: CreateLocationInput): Promise<MerchantLocation>;
  /** `null` if no such location exists for this merchant. */
  updateFields(
    merchantId: string,
    locationId: string,
    patch: EditLocationInput,
  ): Promise<MerchantLocation | null>;
  /**
   * `"not_found"` if no such location exists for this merchant; `"in_use"`
   * if any listing still references it (`store.listing_location`'s FK would
   * refuse the delete anyway -- checked first so the caller gets a clean
   * domain error instead of a raw constraint violation).
   */
  archive(merchantId: string, locationId: string): Promise<"ok" | "not_found" | "in_use">;
}

export const LOCATION_REPOSITORY = Symbol("LOCATION_REPOSITORY");
