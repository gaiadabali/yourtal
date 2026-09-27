export interface CampaignNotFoundError {
  readonly type: "campaign_not_found";
  readonly campaignId: string;
}

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export interface LedgerRefusedError {
  readonly type: "ledger_refused";
  readonly code: string;
  readonly message: string;
}

export interface VoucherRefusedError {
  readonly type: "voucher_refused";
  readonly code: string;
  readonly message: string;
}

export type GetCampaignReportError =
  | CampaignNotFoundError
  | LedgerRefusedError
  | VoucherRefusedError
  | PersistenceFailedError;
