import type { Business } from "@yourtal/contracts/business";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";

/**
 * The one in-process "database" every in-memory repository below reads and
 * writes. Exists only because YT-0022 has not provisioned Postgres yet —
 * `business.module.ts` swaps this whole family for the Drizzle
 * implementations once `AppConfig.databaseUrl` is set. One shared instance
 * per module registration, so a business created through one repository is
 * visible to the others, the way a real connection pool would behave.
 */
export class InMemoryBusinessStore {
  readonly businesses = new Map<string, Business>();
  readonly members = new Map<string, BusinessMember>();
  readonly billingContacts = new Map<string, BillingContact>();
  readonly kybDocuments = new Map<string, KybDocument[]>();
}

export function memberKey(businessId: string, userId: string): string {
  return `${businessId}:${userId}`;
}
