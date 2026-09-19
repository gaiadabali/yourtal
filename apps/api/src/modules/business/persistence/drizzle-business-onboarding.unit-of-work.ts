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

/** UNTESTED against a live Postgres — see `drizzle-client.ts`. */
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
