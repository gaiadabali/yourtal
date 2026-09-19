import type { Business } from "@yourtal/contracts/business";

export interface CreateBusinessAccountInput {
  readonly legalName: string;
  readonly displayName: string;
  readonly district: string;
  readonly roles: Business["roles"];
  readonly logoUrl: string | null;
}

export interface BusinessAccountRepository {
  findById(businessId: string): Promise<Business | null>;
}

export const BUSINESS_ACCOUNT_REPOSITORY = Symbol("BUSINESS_ACCOUNT_REPOSITORY");
