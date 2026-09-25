import type { Currency } from "@yourtal/contracts/money/currency";
import { and, desc, eq, ne } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { applySettlementValueChange } from "./apply-settlement-value-change";
import { settlementDecreaseRequests } from "./schema/settlement-decrease-request.table";
import type { SettlementValueChange } from "./listing.repository";
import type {
  CreateSettlementDecreaseRequestInput,
  SettlementDecreaseRequest,
  SettlementDecreaseRequestRepository,
} from "./settlement-decrease-request.repository";

/**
 * Thrown only to unwind `this.db.transaction` when the value change fails
 * AFTER the request row has already been claimed as approved — rolling the
 * claim back rather than leaving `state = 'approved'` with no applied value.
 * See `approve`'s doc comment. Never leaves this file.
 */
class ApplyFailedAfterClaim extends Error {}

export class DrizzleSettlementDecreaseRequestRepository implements SettlementDecreaseRequestRepository {
  constructor(private readonly db: AppDb) {}

  async findPendingForListing(listingId: string): Promise<SettlementDecreaseRequest | null> {
    const [row] = await this.db
      .select()
      .from(settlementDecreaseRequests)
      .where(
        and(
          eq(settlementDecreaseRequests.listingId, listingId),
          eq(settlementDecreaseRequests.state, "pending"),
        ),
      )
      .orderBy(desc(settlementDecreaseRequests.createdAt))
      .limit(1);
    return row === undefined ? null : toRecord(row);
  }

  async findById(listingId: string, requestId: string): Promise<SettlementDecreaseRequest | null> {
    const [row] = await this.db
      .select()
      .from(settlementDecreaseRequests)
      .where(
        and(
          eq(settlementDecreaseRequests.id, requestId),
          eq(settlementDecreaseRequests.listingId, listingId),
        ),
      )
      .limit(1);
    return row === undefined ? null : toRecord(row);
  }

  async create(input: CreateSettlementDecreaseRequestInput): Promise<SettlementDecreaseRequest> {
    const [row] = await this.db
      .insert(settlementDecreaseRequests)
      .values({
        listingId: input.listingId,
        requestedBy: input.requestedBy,
        currency: input.currency,
        currentSettlementValueMinor: input.currentSettlementValueMinor,
        proposedSettlementValueMinor: input.proposedSettlementValueMinor,
        reason: input.reason,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into store.settlement_decrease_request returned no row");
    }
    return toRecord(row);
  }

  /**
   * The claiming UPDATE carries the actual self-approval control:
   * `ne(requestedBy, approverId)` in the WHERE means a self-approval matches
   * NO ROW, exactly `services/voucher/db/query/issue.sql`'s `ApproveBatch`.
   * `state = 'pending'` in the same WHERE means a second approval attempt,
   * or one racing a first, also matches no row rather than double-applying.
   *
   * If the claim succeeds but the value write fails (should not happen —
   * `listing_id` is a foreign key and `merchantId` was already proven to
   * own it by the controller before this is called — but "should not
   * happen" is not a reason to leave `state = 'approved'` uncommitted to
   * anything), the whole transaction rolls back via `ApplyFailedAfterClaim`
   * and this returns `null` like every other refusal here.
   */
  async approve(
    merchantId: string,
    listingId: string,
    requestId: string,
    approverId: string,
  ): Promise<SettlementValueChange | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(settlementDecreaseRequests)
          .set({ state: "approved", approvedBy: approverId, approvedAt: new Date() })
          .where(
            and(
              eq(settlementDecreaseRequests.id, requestId),
              eq(settlementDecreaseRequests.listingId, listingId),
              eq(settlementDecreaseRequests.state, "pending"),
              ne(settlementDecreaseRequests.requestedBy, approverId),
            ),
          )
          .returning();
        if (claimed === undefined) return null;

        const change = await applySettlementValueChange(
          tx,
          merchantId,
          listingId,
          claimed.proposedSettlementValueMinor,
          claimed.requestedBy,
          claimed.reason ?? "",
          claimed.id,
        );
        if (change === null) {
          throw new ApplyFailedAfterClaim();
        }
        return change;
      });
    } catch (error) {
      if (error instanceof ApplyFailedAfterClaim) return null;
      throw error;
    }
  }
}

function toRecord(row: typeof settlementDecreaseRequests.$inferSelect): SettlementDecreaseRequest {
  return {
    id: row.id,
    listingId: row.listingId,
    requestedBy: row.requestedBy,
    currency: row.currency as Currency,
    currentSettlementValueMinor: row.currentSettlementValueMinor,
    proposedSettlementValueMinor: row.proposedSettlementValueMinor,
    reason: row.reason,
    // The migration's CHECK constraint is the actual enforcement of this
    // union; the cast just names it here rather than widening to `string`.
    state: row.state as SettlementDecreaseRequest["state"],
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
