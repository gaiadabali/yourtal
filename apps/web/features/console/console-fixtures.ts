import type { Business } from "@yourtal/contracts/business";
import { longNameBusinessFixture, mockBusinesses } from "@yourtal/contracts/business/mock";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { businessMemberSchema } from "@yourtal/contracts/business/member";
import { pendingInviteBusinessMemberFixture } from "@yourtal/contracts/business/member/mock";

/**
 * Server-data-only mock cast for the business console (YT-0440/YT-0444).
 * Only `console-data.ts` (a Server Component data module, never a
 * `"use client"` file) imports this — it value-imports `businessMemberSchema`,
 * a Zod schema, which is the correct thing at this boundary and the wrong
 * thing in a client bundle (docs/13b-typescript-standards.md §8).
 *
 * `generateBusinessMember` (business-member.mock.ts) assigns each row a
 * fresh random `businessId`, which is right for a generic catalogue but
 * useless here — a team roster needs every row pinned to ONE business. So
 * this file hand-builds the roster instead, the same way
 * `pendingInviteBusinessMemberFixture` itself was hand-built, and reuses
 * that exact fixture as one of its rows rather than duplicating it — it
 * already targets `longNameBusinessFixture`'s id
 * ("...000000000601") as a pending Marketer invite.
 *
 * The cast names below (Budi/Citra/Eka/Fajar/Gita) deliberately mirror the
 * principal names in `policies/tests/team_test.yaml` and
 * `policies/tests/business_test.yaml` — this is fixture data, not the
 * authorization decision itself, but keeping the names aligned makes it
 * easy to cross-reference "what should this role be able to do" against
 * the actual policy tests while reviewing this UI.
 */

/** The signed-in demo user driving the console in every Phase U screenshot/walkthrough. */
export const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000710";

/**
 * The primary demo business: Budi's own business, where they are Owner.
 * Deliberately `longNameBusinessFixture` (advertiser + supplier, no
 * redeemer) rather than a random `mockBusinesses` entry — it is both the
 * long-merchant-name awkward fixture the brief asks every screen to
 * exercise AND, because it is missing the `redeemer` relationship, the
 * fixture that proves the shell actually hides a zone rather than showing
 * all three unconditionally.
 */
export const PRIMARY_BUSINESS: Business = longNameBusinessFixture;

/**
 * A second business — one Budi has only an Analyst hat at (the "two hats,
 * two answers" case `policies/tests/business_test.yaml` pins). Exercises
 * the business switcher and proves a role is looked up per business, not
 * per person, in the UI too.
 */
export const SECONDARY_BUSINESS: Business = (() => {
  const [business] = mockBusinesses;
  if (!business) {
    throw new Error("mockBusinesses fixture is unexpectedly empty");
  }
  return business;
})();

function member(input: {
  businessId: string;
  userId: string;
  role: BusinessMember["role"];
  invitedAt: string;
  invitedByUserId: string;
  joinedAt: string | null;
}): BusinessMember {
  return businessMemberSchema.parse(input);
}

/** The full roster of `PRIMARY_BUSINESS`, covering all six roles plus one pending invite. */
export const PRIMARY_BUSINESS_ROSTER: BusinessMember[] = [
  member({
    businessId: PRIMARY_BUSINESS.id,
    userId: CURRENT_USER_ID,
    role: "owner",
    invitedAt: "2025-01-10T09:00:00.000Z",
    invitedByUserId: CURRENT_USER_ID,
    joinedAt: "2025-01-10T09:00:00.000Z",
  }),
  member({
    businessId: PRIMARY_BUSINESS.id,
    userId: "00000000-0000-4000-8000-000000000711",
    role: "admin",
    invitedAt: "2025-02-01T09:00:00.000Z",
    invitedByUserId: CURRENT_USER_ID,
    joinedAt: "2025-02-02T10:15:00.000Z",
  }),
  member({
    businessId: PRIMARY_BUSINESS.id,
    userId: "00000000-0000-4000-8000-000000000712",
    role: "merchandiser",
    invitedAt: "2025-03-05T09:00:00.000Z",
    invitedByUserId: "00000000-0000-4000-8000-000000000711",
    joinedAt: "2025-03-06T08:00:00.000Z",
  }),
  member({
    businessId: PRIMARY_BUSINESS.id,
    userId: "00000000-0000-4000-8000-000000000713",
    role: "finance",
    invitedAt: "2025-03-20T09:00:00.000Z",
    invitedByUserId: CURRENT_USER_ID,
    joinedAt: "2025-03-21T09:00:00.000Z",
  }),
  member({
    businessId: PRIMARY_BUSINESS.id,
    userId: "00000000-0000-4000-8000-000000000714",
    role: "analyst",
    invitedAt: "2025-04-01T09:00:00.000Z",
    invitedByUserId: "00000000-0000-4000-8000-000000000711",
    joinedAt: "2025-04-01T14:30:00.000Z",
  }),
  // Reused verbatim, not duplicated — see file docstring.
  pendingInviteBusinessMemberFixture,
];

/** Someone else's business — Budi holds no membership row there at all, and never appears in its roster. */
const SECONDARY_BUSINESS_OWNER_ID = "00000000-0000-4000-8000-000000000799";

/** Budi's own (Analyst) row on `SECONDARY_BUSINESS` — the only row this console needs there for the switcher demo. */
export const SECONDARY_BUSINESS_ROSTER: BusinessMember[] = [
  member({
    businessId: SECONDARY_BUSINESS.id,
    userId: CURRENT_USER_ID,
    role: "analyst",
    invitedAt: "2025-05-01T09:00:00.000Z",
    invitedByUserId: SECONDARY_BUSINESS_OWNER_ID,
    joinedAt: "2025-05-02T09:00:00.000Z",
  }),
];
