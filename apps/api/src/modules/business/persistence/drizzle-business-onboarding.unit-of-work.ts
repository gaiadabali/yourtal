import { businessSchema } from "@yourtal/contracts/business";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { CreateBusinessAccountInput } from "./business-account.repository";
import type {
  BusinessOnboardingUnitOfWork,
  CreateBusinessResult,
} from "./business-onboarding.unit-of-work";
import type { BusinessDb } from "./drizzle-client";
import { businessAccounts } from "./schema/business-account.table";
import { businessMembers } from "./schema/business-member.table";

/**
 * Verified against a live Postgres — YT-0552. The commit path is covered by
 * every use-case test that calls `createBusiness`; the rollback path — that
 * a failure partway through `db.transaction` actually undoes the first
 * insert, not just that the use-case maps a rejected Promise to a `Result`
 * — is covered directly in
 * `drizzle-business-onboarding.unit-of-work.test.ts`, which fails the
 * `business_members` insert for real (a NUL byte in `ownerUserId`, which
 * Postgres text columns reject) and confirms the `business_accounts` row
 * from the same call never persists.
 */
export class DrizzleBusinessOnboardingUnitOfWork implements BusinessOnboardingUnitOfWork {
  constructor(private readonly db: BusinessDb) {}

  async createBusinessWithOwner(
    input: CreateBusinessAccountInput,
    ownerUserId: string,
  ): Promise<CreateBusinessResult> {
    // The transaction docs/13b section 7 asks for — see this unit-of-work's
    // interface doc comment for why it lives here rather than literally in
    // the use-case body.
    return this.db.transaction(async (tx) => {
      const [businessRow] = await tx
        .insert(businessAccounts)
        .values({
          legalName: input.legalName,
          displayName: input.displayName,
          district: input.district,
          roles: input.roles,
          logoUrl: input.logoUrl,
          region: input.region,
          currency: input.currency,
          handle: input.handle,
          coverUrl: input.coverUrl,
        })
        .returning();
      if (businessRow === undefined) {
        throw new Error("insert into business_accounts returned no row");
      }

      const [memberRow] = await tx
        .insert(businessMembers)
        .values({
          businessId: businessRow.id,
          userId: ownerUserId,
          role: "owner",
          invitedByUserId: ownerUserId,
          joinedAt: new Date(),
        })
        .returning();
      if (memberRow === undefined) {
        throw new Error("insert into business_members returned no row");
      }

      const business = businessSchema.parse({
        id: businessRow.id,
        legalName: businessRow.legalName,
        displayName: businessRow.displayName,
        district: businessRow.district,
        roles: businessRow.roles,
        isVerified: businessRow.isVerified,
        logoUrl: businessRow.logoUrl,
        region: businessRow.region,
        currency: businessRow.currency,
        handle: businessRow.handle,
        coverUrl: businessRow.coverUrl,
      });
      const owner: BusinessMember = {
        businessId: memberRow.businessId,
        userId: memberRow.userId,
        role: "owner",
        invitedAt: memberRow.invitedAt.toISOString(),
        invitedByUserId: memberRow.invitedByUserId,
        joinedAt: memberRow.joinedAt === null ? null : memberRow.joinedAt.toISOString(),
      };
      return { business, owner };
    });
  }
}
