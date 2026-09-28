import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { partnerReceipts } from "./schema/partner.table";
import type { PartnerReceiptRepository, RecordReceiptInput } from "./partner-receipt.repository";

export class DrizzlePartnerReceiptRepository implements PartnerReceiptRepository {
  constructor(private readonly db: AppDb) {}

  async recordIfNew(input: RecordReceiptInput): Promise<boolean> {
    const inserted = await this.db
      .insert(partnerReceipts)
      .values(input)
      .onConflictDoNothing()
      .returning({ partnerId: partnerReceipts.partnerId });
    return inserted.length > 0;
  }
}
