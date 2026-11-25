import type { Business } from "@yourtal/contracts/business";

export interface CreateBusinessAccountInput {
  readonly legalName: string;
  readonly displayName: string;
  readonly taxIdKind: Business["taxIdKind"];
  readonly taxIdValue: string;
  readonly addressState: Business["addressState"];
  readonly addressPostcode: Business["addressPostcode"];
  readonly addressCity: Business["addressCity"];
  readonly roles: Business["roles"];
  readonly logoUrl: string | null;
  readonly region: Business["region"];
  readonly currency: Business["currency"];
  readonly handle: string;
  readonly coverUrl: string | null;
}

export interface UpdateChannelInput {
  readonly businessId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
}

/** `null`: no such business. `handle_taken`: another business already owns the handle. */
export type UpdateChannelOutcome = Business | null | "handle_taken";

export interface BusinessAccountRepository {
  findById(businessId: string): Promise<Business | null>;
  /** Region, tax ID and every other field stay as they are. */
  updateChannel(input: UpdateChannelInput): Promise<UpdateChannelOutcome>;
}

export const BUSINESS_ACCOUNT_REPOSITORY = Symbol("BUSINESS_ACCOUNT_REPOSITORY");
