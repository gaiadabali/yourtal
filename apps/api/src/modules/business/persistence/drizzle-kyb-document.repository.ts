import { eq } from "drizzle-orm";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { BusinessDb } from "./drizzle-client";
import type { KybDocumentRepository, SubmitKybDocumentInput } from "./kyb-document.repository";
import { kybDocuments } from "./schema/kyb-document.table";

/**
 * Verified against a live Postgres — YT-0552. `submit-kyb-document.use-case.test.ts`
 * exercises `submit` and `listByBusiness` through `business-db.test-helper.ts`'s
 * real connection, including the `kyb_documents_verified_has_reviewer` CHECK.
 */
export class DrizzleKybDocumentRepository implements KybDocumentRepository {
  constructor(private readonly db: BusinessDb) {}

  async submit(input: SubmitKybDocumentInput): Promise<KybDocument> {
    const [row] = await this.db
      .insert(kybDocuments)
      .values({
        businessId: input.businessId,
        documentType: input.documentType,
        storageRef: input.storageRef,
        status: "submitted",
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into kyb_documents returned no row");
    }
    return toDomain(row);
  }

  async listByBusiness(businessId: string): Promise<KybDocument[]> {
    const rows = await this.db
      .select()
      .from(kybDocuments)
      .where(eq(kybDocuments.businessId, businessId));
    return rows.map(toDomain);
  }
}

function toDomain(row: typeof kybDocuments.$inferSelect): KybDocument {
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
