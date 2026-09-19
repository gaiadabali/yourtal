import type { Business } from "@yourtal/contracts/business";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import {
  CURRENT_USER_ID,
  PRIMARY_BUSINESS,
  PRIMARY_BUSINESS_ROSTER,
  SECONDARY_BUSINESS,
  SECONDARY_BUSINESS_ROSTER,
} from "./console-fixtures";

/**
 * The business console's single data-access seam, same shape as
 * `features/wallet/wallet-data.ts` and `features/store/store-data.ts`
 * (docs/tasks/phase-u-ui.md preamble: "one switch flips every screen
 * between mock and live"). Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx`/`layout.tsx` Server
 * Components under `app/(app)/business/**` import this module.
 */
export interface BusinessMembership {
  business: Business;
  /** The signed-in person's own role at this business, or `null` if they hold none (should not happen for a business `listBusinessesForCurrentPerson` returned). */
  myRole: BusinessMember["role"] | null;
  roster: BusinessMember[];
}

const MOCK_MEMBERSHIPS: BusinessMembership[] = [
  { business: PRIMARY_BUSINESS, myRole: "owner", roster: PRIMARY_BUSINESS_ROSTER },
  { business: SECONDARY_BUSINESS, myRole: "analyst", roster: SECONDARY_BUSINESS_ROSTER },
];

interface ConsoleDataSource {
  listMyBusinesses: () => Promise<BusinessMembership[]>;
  getBusinessMembership: (businessId: string) => Promise<BusinessMembership | undefined>;
}

const mockDataSource: ConsoleDataSource = {
  listMyBusinesses: () => Promise.resolve(MOCK_MEMBERSHIPS),
  getBusinessMembership: (businessId) =>
    Promise.resolve(MOCK_MEMBERSHIPS.find((membership) => membership.business.id === businessId)),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live business console data source is not implemented yet (Phase U is mock-only).";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see `store-data.ts` for the same reasoning.
 */
const liveDataSource: ConsoleDataSource = {
  listMyBusinesses: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  getBusinessMembership: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const consoleDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** Every business the signed-in person holds any role at, with their own role and its full roster. */
export function listMyBusinesses(): Promise<BusinessMembership[]> {
  return consoleDataSource.listMyBusinesses();
}

/** One business's membership record, or `undefined` if the signed-in person holds no role there (or it does not exist). */
export function getBusinessMembership(businessId: string): Promise<BusinessMembership | undefined> {
  return consoleDataSource.getBusinessMembership(businessId);
}

/** The id used as the current-session demo user throughout the console (invite/remove/audit call sites). */
export function getCurrentUserId(): string {
  return CURRENT_USER_ID;
}
