export interface RecordReceiptInput {
  readonly partnerId: string;
  readonly receiptHash: string;
  readonly userId: string;
  readonly externalRef: string;
}

export interface ReceiptClaim {
  /** `false` if (partnerId, receiptHash) was already recorded — TASKS.md 8.4.a's uniqueness rule. */
  readonly isNew: boolean;
  /** The account the receipt was first recorded for. */
  readonly userId: string;
}

export interface PartnerReceiptRepository {
  claim(input: RecordReceiptInput): Promise<ReceiptClaim>;
}

export const PARTNER_RECEIPT_REPOSITORY = Symbol("PARTNER_RECEIPT_REPOSITORY");
