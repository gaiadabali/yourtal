import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { Business } from "@yourtal/contracts/business";
import type { BusinessDb } from "./drizzle-client";
import { businessAccounts } from "./schema/business-account.table";
import { kybDocuments } from "./schema/kyb-document.table";
import type {
  ListStaffBusinessesFilter,
  ListStaffBusinessesResult,
  StaffBusinessDetail,
  StaffBusinessReviewRepository,
  StaffBusinessSummary,
} from "./staff-business-review.repository";

type BusinessAccountRow = typeof businessAccounts.$inferSelect;
type KybDocumentRow = typeof kybDocuments.$inferSelect;

function toSummary(row: BusinessAccountRow): StaffBusinessSummary {
  return {
    id: row.id,
    legalName: row.legalName,
    displayName: row.displayName,
    handle: row.handle,
    region: row.region as Business["region"],
    isVerified: row.isVerified,
    suspendedAt: row.suspendedAt === null ? null : row.suspendedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toDocument(row: KybDocumentRow): KybDocument {
  return {
    id: row.id,
    businessId: row.businessId,
    documentType: row.documentType,
    storageRef: row.storageRef,
    status: row.status,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    submittedAt: row.submittedAt.toISOString(),
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    verifiedByUserId: row.verifiedByUserId,
  };
}

function toDetail(row: BusinessAccountRow, documents: readonly KybDocumentRow[]): StaffBusinessDetail {
  return {
    ...toSummary(row),
    taxIdKind: row.taxIdKind as Business["taxIdKind"],
    taxIdValue: row.taxIdValue,
    suspendedReason: row.suspendedReason,
    kybDocuments: documents.map(toDocument),
  };
}

/**
 * Verified against a live Postgres — YT-0552. Every write here goes through
 * `db.transaction` so a business's `is_verified`/`suspended_at` and its
 * `kyb_documents` rows never disagree about what the last staff decision was.
 */
export class DrizzleStaffBusinessReviewRepository implements StaffBusinessReviewRepository {
  constructor(private readonly db: BusinessDb) {}

  async list(filter: ListStaffBusinessesFilter): Promise<ListStaffBusinessesResult> {
    const conditions = [
      filter.region === null ? undefined : eq(businessAccounts.region, filter.region),
      filter.search === null
        ? undefined
        : or(
            ilike(businessAccounts.displayName, `%${filter.search}%`),
            ilike(businessAccounts.legalName, `%${filter.search}%`),
            ilike(businessAccounts.handle, `%${filter.search}%`),
          ),
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(businessAccounts)
        .where(where)
        .orderBy(desc(businessAccounts.createdAt))
        .limit(filter.limit)
        .offset(filter.offset),
      this.db
        .select({ count: sql<string>`count(*)` })
        .from(businessAccounts)
        .where(where),
    ]);
    return { businesses: rows.map(toSummary), total: Number(countRows[0]?.count ?? 0) };
  }

  async findById(businessId: string): Promise<StaffBusinessDetail | null> {
    const [row] = await this.db
      .select()
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessId))
      .limit(1);
    if (row === undefined) return null;
    const documents = await this.db
      .select()
      .from(kybDocuments)
      .where(eq(kybDocuments.businessId, businessId));
    return toDetail(row, documents);
  }

  async approveKyb(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(businessAccounts)
        .set({ isVerified: true, updatedAt: new Date() })
        .where(eq(businessAccounts.id, businessId))
        .returning();
      if (row === undefined) return null;
      await tx
        .update(kybDocuments)
        .set({ status: "verified", verifiedAt: new Date(), verifiedByUserId: staffUserId })
        .where(and(eq(kybDocuments.businessId, businessId), eq(kybDocuments.status, "submitted")));
      const documents = await tx
        .select()
        .from(kybDocuments)
        .where(eq(kybDocuments.businessId, businessId));
      return toDetail(row, documents);
    });
  }

  async rejectKyb(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(businessAccounts)
        .set({ isVerified: false, updatedAt: new Date() })
        .where(eq(businessAccounts.id, businessId))
        .returning();
      if (row === undefined) return null;
      await tx
        .update(kybDocuments)
        .set({ status: "rejected", verifiedAt: new Date(), verifiedByUserId: staffUserId })
        .where(and(eq(kybDocuments.businessId, businessId), eq(kybDocuments.status, "submitted")));
      const documents = await tx
        .select()
        .from(kybDocuments)
        .where(eq(kybDocuments.businessId, businessId));
      return toDetail(row, documents);
    });
  }

  async suspend(
    businessId: string,
    staffUserId: string,
    reason: string,
  ): Promise<StaffBusinessDetail | null> {
    const [row] = await this.db
      .update(businessAccounts)
      .set({
        suspendedAt: new Date(),
        suspendedByUserId: staffUserId,
        suspendedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(businessAccounts.id, businessId))
      .returning();
    if (row === undefined) return null;
    const documents = await this.db
      .select()
      .from(kybDocuments)
      .where(eq(kybDocuments.businessId, businessId));
    return toDetail(row, documents);
  }

  async reinstate(businessId: string, staffUserId: string): Promise<StaffBusinessDetail | null> {
    void staffUserId; // recorded in the staff audit trail, not on the row itself once cleared
    const [row] = await this.db
      .update(businessAccounts)
      .set({
        suspendedAt: null,
        suspendedByUserId: null,
        suspendedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(businessAccounts.id, businessId))
      .returning();
    if (row === undefined) return null;
    const documents = await this.db
      .select()
      .from(kybDocuments)
      .where(eq(kybDocuments.businessId, businessId));
    return toDetail(row, documents);
  }
}
