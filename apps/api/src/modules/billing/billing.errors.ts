/** Discriminated unions on `type` for every expected failure this module's use-cases can produce. */

export interface BusinessNotFoundError {
  readonly type: "business_not_found";
  readonly businessId: string;
}

/** TASKS.md 7.5.a: the caller must state the currency it expects; a mismatch is refused, never coerced. */
export interface CurrencyMismatchError {
  readonly type: "currency_mismatch";
  readonly expected: string;
  readonly stated: string;
}

export interface LedgerRefusedError {
  readonly type: "ledger_refused";
  readonly code: string;
  readonly message: string;
}

export interface PaymentDeclinedError {
  readonly type: "payment_declined";
  readonly detail: string;
}

/** 5.1.a: the processor could not be reached or answered oddly; the same key is safe to retry. */
export interface PaymentUnavailableError {
  readonly type: "payment_unavailable";
  readonly detail: string;
}

/** 5.1.a: an Idempotency-Key already used for a different purchase. */
export interface PurchaseConflictError {
  readonly type: "purchase_conflict";
}

/** 2.10.b (F127): the business is not the approved receipt funder in its region. */
export interface NotAReceiptFunderError {
  readonly type: "not_a_receipt_funder";
}

export interface PurchaseNotFoundError {
  readonly type: "purchase_not_found";
  readonly purchaseId: string;
}

export interface CampaignSpendNotOwnedError {
  readonly type: "campaign_spend_not_owned";
  readonly campaignId: string;
}

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export type QuotePurchaseError =
  BusinessNotFoundError | LedgerRefusedError | PersistenceFailedError;

export type PurchasePointsError =
  | BusinessNotFoundError
  | CurrencyMismatchError
  | PaymentDeclinedError
  | PaymentUnavailableError
  | PurchaseConflictError
  | NotAReceiptFunderError
  | LedgerRefusedError
  | PersistenceFailedError;

/** 2.10.b: the funder's receipt-programme read. */
export type ReceiptProgrammeError =
  BusinessNotFoundError | NotAReceiptFunderError | LedgerRefusedError | PersistenceFailedError;

export type GetBalanceError = BusinessNotFoundError | LedgerRefusedError | PersistenceFailedError;

export type GetCampaignSpendError =
  CampaignSpendNotOwnedError | LedgerRefusedError | PersistenceFailedError;

/** 10.1.b/10.6.b: listing a business's own statements never fails on anything but the ledger call itself. */
export type ListStatementsError = LedgerRefusedError;
