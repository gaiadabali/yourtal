import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { listings } from "./schema/listing.table";
import { voucherBatchRequests } from "./schema/voucher-batch-request.table";
import type {
  CreateVoucherBatchRequestInput,
  VoucherBatchRequest,
  VoucherBatchRequestRepository,
} from "./voucher-batch-request.repository";

function toRecord(row: typeof voucherBatchRequests.$inferSelect): VoucherBatchRequest {
  return {
    id: row.id,
    listingId: row.listingId,
    merchantId: row.merchantId,
    quantity: row.quantity,
    requestedBy: row.requestedBy,
    reason: row.reason,
    // The migration's CHECK constraint enforces this union.
    state: row.state as VoucherBatchRequest["state"],
    approvedBy: row.approvedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    mintedBatchId: row.mintedBatchId,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleVoucherBatchRequestRepository implements VoucherBatchRequestRepository {
  constructor(private readonly db: AppDb) {}

  async listOwned(merchantId: string): Promise<VoucherBatchRequest[]> {
    const rows = await this.db
      .select()
      .from(voucherBatchRequests)
      .where(eq(voucherBatchRequests.merchantId, merchantId))
      .orderBy(desc(voucherBatchRequests.createdAt));
    return rows.map(toRecord);
  }

  async findOwnedById(merchantId: string, requestId: string): Promise<VoucherBatchRequest | null> {
    const [row] = await this.db
      .select()
      .from(voucherBatchRequests)
      .where(
        and(
          eq(voucherBatchRequests.id, requestId),
          eq(voucherBatchRequests.merchantId, merchantId),
        ),
      )
      .limit(1);
    return row === undefined ? null : toRecord(row);
  }

  async create(
    merchantId: string,
    input: CreateVoucherBatchRequestInput,
  ): Promise<VoucherBatchRequest | null> {
    // Proves the listing belongs to this tenant BEFORE inserting -- the same
    // shape `createListing`'s location check follows, since there is no FK
    // from voucher_batch_request back to "this merchant owns this listing".
    const [owned] = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, input.listingId), eq(listings.merchantId, merchantId)))
      .limit(1);
    if (owned === undefined) return null;

    const [row] = await this.db
      .insert(voucherBatchRequests)
      .values({
        id: randomUUID(),
        listingId: input.listingId,
        merchantId,
        quantity: input.quantity,
        requestedBy: input.requestedBy,
        reason: input.reason,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into store.voucher_batch_request returned no row");
    }
    return toRecord(row);
  }

  async listPending(): Promise<VoucherBatchRequest[]> {
    const rows = await this.db
      .select()
      .from(voucherBatchRequests)
      .where(eq(voucherBatchRequests.state, "pending"))
      .orderBy(desc(voucherBatchRequests.createdAt));
    return rows.map(toRecord);
  }

  async findById(requestId: string): Promise<VoucherBatchRequest | null> {
    const [row] = await this.db
      .select()
      .from(voucherBatchRequests)
      .where(eq(voucherBatchRequests.id, requestId))
      .limit(1);
    return row === undefined ? null : toRecord(row);
  }

  async approve(
    requestId: string,
    approvedBy: string,
    mintedBatchId: string,
  ): Promise<VoucherBatchRequest | null> {
    const [row] = await this.db
      .update(voucherBatchRequests)
      .set({
        state: "approved",
        approvedBy,
        decidedAt: new Date(),
        mintedBatchId,
      })
      .where(
        and(
          eq(voucherBatchRequests.id, requestId),
          eq(voucherBatchRequests.state, "pending"),
          ne(voucherBatchRequests.requestedBy, approvedBy),
        ),
      )
      .returning();
    return row === undefined ? null : toRecord(row);
  }

  async reject(requestId: string, decidedBy: string): Promise<VoucherBatchRequest | null> {
    const [row] = await this.db
      .update(voucherBatchRequests)
      .set({ state: "rejected", approvedBy: decidedBy, decidedAt: new Date() })
      .where(
        and(
          eq(voucherBatchRequests.id, requestId),
          eq(voucherBatchRequests.state, "pending"),
          ne(voucherBatchRequests.requestedBy, decidedBy),
        ),
      )
      .returning();
    return row === undefined ? null : toRecord(row);
  }
}
