import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { partnerReceipts } from "./schema/partner.table";
import type {
  PartnerReceiptRepository,
  ReceiptClaim,
  RecordReceiptInput,
} from "./partner-receipt.repository";

export class DrizzlePartnerReceiptRepository implements PartnerReceiptRepository {
  constructor(private readonly db: AppDb) {}

  async claim(input: RecordReceiptInput): Promise<ReceiptClaim> {
    const inserted = await this.db
      .insert(partnerReceipts)
      .values(input)
      .onConflictDoNothing()
      .returning({ userId: partnerReceipts.userId });
    if (inserted[0] !== undefined) return { isNew: true, userId: inserted[0].userId };

    const [existing] = await this.db
      .select({ userId: partnerReceipts.userId })
      .from(partnerReceipts)
      .where(
        and(
          eq(partnerReceipts.partnerId, input.partnerId),
          eq(partnerReceipts.receiptHash, input.receiptHash),
        ),
      )
      .limit(1);
    if (existing === undefined) throw new Error("partner receipt conflicted but was not found");
    return { isNew: false, userId: existing.userId };
  }
}
