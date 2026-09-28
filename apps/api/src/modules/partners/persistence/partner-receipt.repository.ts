export interface RecordReceiptInput {
  readonly partnerId: string;
  readonly receiptHash: string;
  readonly userId: string;
  readonly externalRef: string;
}

export interface PartnerReceiptRepository {
  /** `false` if (partnerId, receiptHash) already exists — TASKS.md 8.4.a's own uniqueness rule. */
  recordIfNew(input: RecordReceiptInput): Promise<boolean>;
}

export const PARTNER_RECEIPT_REPOSITORY = Symbol("PARTNER_RECEIPT_REPOSITORY");
