import type { Currency } from "@yourtal/contracts/money/currency";
import type { Region } from "@yourtal/contracts/region";

export interface BusinessRegionAndCurrency {
  readonly region: Region;
  readonly currency: Currency;
}

/**
 * TASKS.md 1.1.h: a listing's `region` and `currency` come from its owning
 * business, never from the caller — `businessSchema.region` is immutable and
 * its `currency` is a pure function of it (F2), so accepting either in a
 * request body would just be a second, potentially-mismatched copy of a fact
 * the business row already states.
 *
 * A port rather than a direct repository import so `store` does not gain a
 * NestJS dependency on the `business` module — `business.business_accounts`
 * is a plain cross-schema read (`yourtal_app` holds SELECT there, unlike the
 * `ledger` schema), the same shape `DeviceCredentialVerifier` uses for
 * 1.5.c's cross-module concern.
 */
export interface BusinessRegionLookup {
  /** `null` if no business exists with this id. */
  findRegionAndCurrency(businessId: string): Promise<BusinessRegionAndCurrency | null>;
}

export const BUSINESS_REGION_LOOKUP = Symbol("BUSINESS_REGION_LOOKUP");
