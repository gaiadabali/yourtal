import { randomUUID } from "node:crypto";
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
 * The fix is a reconciliation read, gated two ways so it can only ever
 * confirm THIS attempt's own write, never mask a genuine refusal:
 *
 *   1. The business id is generated here, before the transaction, and
 *      inserted explicitly (overriding the column's own `defaultRandom()`).
 *      Reconciliation matches on THAT id, not on `handle` — an owner who
 *      reuses a handle they already used for an EARLIER business would, if
 *      matched by handle alone, have that earlier business's row handed
 *      back as if this new (rightly-refused) request had succeeded. A
 *      fresh, client-generated UUID cannot collide with any pre-existing
 *      row, by construction, so a match is possible only when this exact
 *      call's own two inserts both landed.
 *   2. Reconciliation only runs for errors `isAmbiguousCommitError` calls
 *      ambiguous — connection/timeout/unknown-commit-state, no recognisable
 *      Postgres SQLSTATE, or one outside classes 22 (data exception) and 23
 *      (integrity constraint violation). A genuine 23505 on the `handle`
 *      unique index (or the class-22 NUL-byte case below) means Postgres
 *      definitely rejected the write — there is no ambiguity to resolve,
 *      and reconciling anyway is exactly how a real conflict would get
 *      mistaken for success.
 */
export class DrizzleBusinessOnboardingUnitOfWork implements BusinessOnboardingUnitOfWork {
  constructor(private readonly db: BusinessDb) {}

  async createBusinessWithOwner(
    input: CreateBusinessAccountInput,
    ownerUserId: string,
  ): Promise<CreateBusinessResult> {
    const businessId = randomUUID();
    try {
      // The transaction docs/13b section 7 asks for — see this unit-of-work's
      // interface doc comment for why it lives here rather than literally in
      // the use-case body.
      return await this.db.transaction(async (tx) => {
        const [businessRow] = await tx
          .insert(businessAccounts)
          .values({
            id: businessId,
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
      if (isAmbiguousCommitError(error)) {
        const reconciled = await this.findOwnCommit(businessId, ownerUserId);
        if (reconciled !== null) return reconciled;
      }
      throw error;
    }
  }

  /**
   * Ground truth for "did MY OWN write actually commit", asked only after
   * `db.transaction` has already reported an AMBIGUOUS failure. Matched by
   * the id this call itself generated — see the class doc comment for why
   * that, and not `handle`, is what makes this safe to trust unconditionally.
   */
  private async findOwnCommit(
    businessId: string,
    ownerUserId: string,
  ): Promise<CreateBusinessResult | null> {
    const [row] = await this.db
      .select({ business: businessAccounts, member: businessMembers })
      .from(businessAccounts)
      .innerJoin(businessMembers, eq(businessMembers.businessId, businessAccounts.id))
      .where(
        and(
          eq(businessAccounts.id, businessId),
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

/**
 * The Postgres SQLSTATE, when the driver attached one. `node-postgres` puts
 * it on `.code` for a real server-side error, but `drizzle-orm` wraps every
 * query error in its own `DrizzleQueryError` first (confirmed by hand
 * against this same container: `.code` is `undefined`, `.cause.code` is the
 * real SQLSTATE) — one level of `.cause` is where it actually lives.
 */
function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  const causeCode = (cause as { code?: unknown }).code;
  return typeof causeCode === "string" ? causeCode : undefined;
}

/**
 * Whether re-checking the database for this attempt's own row is safe to
 * try. See the class doc comment (point 2) for the reasoning: classes 22
 * (data exception — e.g. `22021`, the NUL-byte case
 * `drizzle-business-onboarding.unit-of-work.test.ts` already exercises) and
 * 23 (integrity constraint violation — e.g. `23505` on the `handle` unique
 * index) are genuine, unambiguous refusals with nothing to reconcile.
 * Anything else — no SQLSTATE at all (a connection reset, a client-side
 * timeout), or a SQLSTATE outside those two classes — is exactly the
 * "we don't know if our own commit landed" case this exists for.
 */
function isAmbiguousCommitError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (code === undefined) return true;
  const sqlstateClass = code.slice(0, 2);
  return sqlstateClass !== "22" && sqlstateClass !== "23";
}
