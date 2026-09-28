export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export interface InvalidLinkCodeError {
  readonly type: "invalid_link_code";
}

export interface DuplicateReceiptError {
  readonly type: "duplicate_receipt";
}

export type PartnerActionError =
  PersistenceFailedError | InvalidLinkCodeError | DuplicateReceiptError;
