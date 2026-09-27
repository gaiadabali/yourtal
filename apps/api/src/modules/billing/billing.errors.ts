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
  | LedgerRefusedError
  | PersistenceFailedError;

export type GetBalanceError = BusinessNotFoundError | LedgerRefusedError | PersistenceFailedError;

export type GetCampaignSpendError =
  CampaignSpendNotOwnedError | LedgerRefusedError | PersistenceFailedError;
