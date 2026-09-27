import type { Business } from "@yourtal/contracts/business";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import {
  AU_BUSINESS,
  AU_BUSINESS_ROSTER,
  CURRENT_USER_ID,
  PRIMARY_BUSINESS,
  PRIMARY_BUSINESS_ROSTER,
  SECONDARY_BUSINESS,
  SECONDARY_BUSINESS_ROSTER,
} from "./studio-fixtures";
import type { CreateBusinessInput } from "./onboarding/business-onboarding-input";

/**
 * The business console's single data-access seam, same shape as
 * `features/wallet/wallet-data.ts` and `features/store/store-data.ts`
 * (docs/tasks/phase-u-ui.md preamble: "one switch flips every screen
 * between mock and live"). Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx`/`layout.tsx` Server
 * Components under `app/(business)/studio/**` import this module.
 */
export interface BusinessMembership {
  business: Business;
  /** The signed-in person's own role at this business, or `null` if they hold none (should not happen for a business `listBusinessesForCurrentPerson` returned). */
  myRole: BusinessMember["role"] | null;
  roster: BusinessMember[];
}

// `let`, not `const`: `createBusiness`'s mock implementation appends to this
// array so a freshly "created" business shows up on the next request within
// the same dev process — mirroring `team-actions.ts`'s in-memory-mutation
// idiom, one level up (module scope instead of a client `useState`) because
// onboarding runs before any `StudioChrome` client tree exists to hold it.
// Resets on server restart; that is fine for a mock seam that a real
// `POST /api/me/businesses` (7.1.b) replaces outright once it lands.
let MOCK_MEMBERSHIPS: BusinessMembership[] = [
  { business: PRIMARY_BUSINESS, myRole: "owner", roster: PRIMARY_BUSINESS_ROSTER },
  { business: SECONDARY_BUSINESS, myRole: "analyst", roster: SECONDARY_BUSINESS_ROSTER },
  { business: AU_BUSINESS, myRole: "owner", roster: AU_BUSINESS_ROSTER },
];

export interface ChannelSettingsInput {
  displayName: string;
  handle: string;
  logoUrl: string | null;
  coverUrl: string | null;
}

interface StudioDataSource {
  listMyBusinesses: () => Promise<BusinessMembership[]>;
  getBusinessMembership: (businessId: string) => Promise<BusinessMembership | undefined>;
  createBusiness: (input: CreateBusinessInput) => Promise<Business>;
  updateChannelSettings: (businessId: string, input: ChannelSettingsInput) => Promise<Business>;
}

const mockDataSource: StudioDataSource = {
  listMyBusinesses: () => Promise.resolve(MOCK_MEMBERSHIPS),
  getBusinessMembership: (businessId) =>
    Promise.resolve(MOCK_MEMBERSHIPS.find((membership) => membership.business.id === businessId)),
  createBusiness: (input) => {
    const business: Business = {
      id: crypto.randomUUID(),
      legalName: input.legalName,
      displayName: input.displayName,
      taxIdKind: input.taxIdKind,
      taxIdValue: input.taxIdValue,
      addressState: input.state ?? null,
      addressPostcode: input.postcode ?? null,
      addressCity: input.city ?? null,
      roles: ["advertiser"],
      isVerified: false,
      logoUrl: null,
      region: input.region,
      currency: input.region === "AU" ? "AUD" : "IDR",
      handle: input.handle,
      coverUrl: null,
    };
    MOCK_MEMBERSHIPS = [...MOCK_MEMBERSHIPS, { business, myRole: "owner", roster: [] }];
    return Promise.resolve(business);
  },
  updateChannelSettings: (businessId, input) => {
    const membership = MOCK_MEMBERSHIPS.find((entry) => entry.business.id === businessId);
    if (!membership) return Promise.reject(new Error(`Unknown business: ${businessId}`));
    const business: Business = {
      ...membership.business,
      displayName: input.displayName,
      handle: input.handle,
      logoUrl: input.logoUrl,
      coverUrl: input.coverUrl,
    };
    MOCK_MEMBERSHIPS = MOCK_MEMBERSHIPS.map((entry) =>
      entry.business.id === businessId ? { ...entry, business } : entry,
    );
    return Promise.resolve(business);
  },
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live Studio data source is not implemented yet — 7.1's business-account API has not landed on main.";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see `store-data.ts` for the same reasoning.
 */
const liveDataSource: StudioDataSource = {
  listMyBusinesses: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  getBusinessMembership: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  createBusiness: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  updateChannelSettings: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const studioDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** Every business the signed-in person holds any role at, with their own role and its full roster. */
export function listMyBusinesses(): Promise<BusinessMembership[]> {
  return studioDataSource.listMyBusinesses();
}

/** One business's membership record, or `undefined` if the signed-in person holds no role there (or it does not exist). */
export function getBusinessMembership(businessId: string): Promise<BusinessMembership | undefined> {
  return studioDataSource.getBusinessMembership(businessId);
}

/** Registers a new business for the signed-in person, who becomes its Owner (task 7.8's onboarding screen). */
export function createBusiness(input: CreateBusinessInput): Promise<Business> {
  return studioDataSource.createBusiness(input);
}

/** Updates a business's public channel identity — logo, cover and handle (task 7.8's Channel settings zone). */
export function updateChannelSettings(
  businessId: string,
  input: ChannelSettingsInput,
): Promise<Business> {
  return studioDataSource.updateChannelSettings(businessId, input);
}

/** The id used as the current-session demo user throughout the console (invite/remove/audit call sites). */
export function getCurrentUserId(): string {
  return CURRENT_USER_ID;
}
