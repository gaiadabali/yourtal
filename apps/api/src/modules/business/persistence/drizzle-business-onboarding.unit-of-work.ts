import { and, eq } from "drizzle-orm";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
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
 *
 * TASKS.md 7.1.e: `db.transaction`'s own `await`ed `commit` sits inside the
 * SAME `try` as the caller's work (`drizzle-orm/node-postgres/session.js`'s
 * `NodePgSession.transaction`) — if that specific round trip throws (a
 * timeout/connection hiccup while Postgres is busy, e.g. lock contention
 * from a concurrent `atlas migrate apply`), Postgres may already have
 * durably committed before the client's read of the acknowledgement failed,
 * but drizzle's wrapper cannot tell the difference from the exception alone:
 * it sends a (by-then-harmless, no-op) `ROLLBACK` and rethrows the original
 * error regardless. Left as "rethrow and let the caller map it to
 * persistence_failed", this reports 503 for a write that already committed
 * — the exact bug D's live-verify found twice.
 *
 * The fix is a reconciliation read, not a retry or a different transaction
 * shape: on ANY error from `db.transaction`, re-check reality by `handle`
 * (unique) joined to a `business_members` row naming THIS caller as owner.
 * That join can only exist if THIS call's own two inserts both landed — no
 * other request could have produced it — so finding it means the write is
 * real regardless of what the exception said, and the caller gets its 201
 * (or the idempotency interceptor's replay of one) instead of a false 503.
 * If nothing matches, the error is genuine (a real rollback, or someone
 * else's handle) and is rethrown unchanged.
 */
export class DrizzleBusinessOnboardingUnitOfWork implements BusinessOnboardingUnitOfWork {
  constructor(private readonly db: BusinessDb) {}

  async createBusinessWithOwner(
    input: CreateBusinessAccountInput,
    ownerUserId: string,
  ): Promise<CreateBusinessResult> {
    try {
      // The transaction docs/13b section 7 asks for — see this unit-of-work's
      // interface doc comment for why it lives here rather than literally in
      // the use-case body.
      return await this.db.transaction(async (tx) => {
        const [businessRow] = await tx
          .insert(businessAccounts)
          .values({
            legalName: input.legalName,
            displayName: input.displayName,
            taxIdKind: input.taxIdKind,
            taxIdValue: input.taxIdValue,
            addressState: input.addressState,
            addressPostcode: input.addressPostcode,
            addressCity: input.addressCity,
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

        return toResult(businessRow, memberRow);
      });
    } catch (error) {
      const reconciled = await this.findOwnCommit(input.handle, ownerUserId);
      if (reconciled !== null) return reconciled;
      throw error;
    }
  }

  /**
   * Ground truth for "did MY OWN write actually commit", asked only after
   * `db.transaction` has already reported failure. A plain `SELECT`, on
   * whatever connection the pool hands back — the ambiguity this recovers
   * from is specific to the ORIGINAL transaction's commit round trip, not to
   * reads in general.
   */
  private async findOwnCommit(
    handle: string,
    ownerUserId: string,
  ): Promise<CreateBusinessResult | null> {
    const [row] = await this.db
      .select({ business: businessAccounts, member: businessMembers })
      .from(businessAccounts)
      .innerJoin(businessMembers, eq(businessMembers.businessId, businessAccounts.id))
      .where(
        and(
          eq(businessAccounts.handle, handle),
          eq(businessMembers.userId, ownerUserId),
          eq(businessMembers.role, "owner"),
        ),
      )
      .limit(1);
    return row === undefined ? null : toResult(row.business, row.member);
  }
}

/** Row shapes -> the domain result, shared by the happy path and the reconciliation read. */
function toResult(
  businessRow: typeof businessAccounts.$inferSelect,
  memberRow: typeof businessMembers.$inferSelect,
): CreateBusinessResult {
  const business: Business = businessSchema.parse({
    id: businessRow.id,
    legalName: businessRow.legalName,
    displayName: businessRow.displayName,
    taxIdKind: businessRow.taxIdKind,
    taxIdValue: businessRow.taxIdValue,
    addressState: businessRow.addressState,
    addressPostcode: businessRow.addressPostcode,
    addressCity: businessRow.addressCity,
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
}
