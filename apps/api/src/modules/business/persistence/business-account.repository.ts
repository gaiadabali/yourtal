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

export interface BusinessAccountRepository {
  findById(businessId: string): Promise<Business | null>;
}

export const BUSINESS_ACCOUNT_REPOSITORY = Symbol("BUSINESS_ACCOUNT_REPOSITORY");
