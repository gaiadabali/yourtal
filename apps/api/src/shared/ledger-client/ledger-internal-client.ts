import type { ResultAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerSettingsOperations } from "@yourtal/contracts/ledger-internal/settings";
import type {
  LockQuoteRequest,
  PriceListingRequest,
  PriceListingResult,
  Quote,
  QuotePurchaseRequest,
  QuotePurchaseResult,
  QuoteRequest,
  ValuePointsRequest,
  ValuePointsResult,
} from "@yourtal/contracts/ledger-internal/pricing";
import type {
  Allocation,
  CampaignSpend,
  Hold,
  HoldRequest,
  PurchasePointsRequest,
  ReturnGrantRequest,
} from "@yourtal/contracts/ledger-internal/funding";
import type {
  Burn,
  BurnForVoucherRequest,
  Grant,
  GrantActionRequest,
  GrantRewardRequest,
} from "@yourtal/contracts/ledger-internal/rewards";
import type {
  AdvanceHoldbackRequest,
  AdvanceHoldbackResult,
} from "@yourtal/contracts/ledger-internal/dev";
import type {
  Escrow,
  EscrowRequest,
  HistoryRequest,
  LedgerBalance,
  LedgerHistoryEntry,
} from "@yourtal/contracts/ledger-internal/wallet";
import type {
  RiskFlag,
  RiskQueueList,
  RiskQueueListRequest,
  RiskQueueResolveRequest,
} from "@yourtal/contracts/ledger-internal/risk";
import type {
  ApproveRateRequest,
  ApprovePayoutRequest,
  Coverage,
  DisputeStatementRequest,
  EconomyDailyRequest,
  EconomyDayRow,
  FundMarketingRequest,
  ProposeRateRequest,
  RateProposal,
  ReleaseVoucherLiabilityRequest,
  ResolveStatementDisputeRequest,
  Statement,
  StatementsRequest,
} from "@yourtal/contracts/ledger-internal/economy";
import type {
  CaptureRecoveryPosting,
  CapturePosting,
  CaptureVoucherRequest,
  RecoverCaptureRequest,
} from "@yourtal/contracts/ledger-internal/capture";
import type { ProvedDay } from "@yourtal/contracts/ledger-internal/proof";

/**
 * TASKS.md 1.2.a. One interface, two implementations: `FakeLedgerClient`
 * (1.2.d, real semantics against `platform.ledger_fake_*`) and
 * `HttpLedgerClient` (calls the real service once 4.1 lands its routes).
 * `createLedgerClient` picks between them from `LEDGER_MODE`.
 *
 * Every method returns `ResultAsync<T, LedgerError>` — `LedgerError` is the
 * closed enum 1.2.c shares with `voucher-internal`, because every caller
 * needs to switch on the failure rather than pattern-match a string.
 *
 * `getSettings`, `proposeSetting` and `approveSetting` (1.2.f, F12,
 * `@yourtal/contracts/ledger-internal/settings`) are the one exception to
 * "every method returns `ResultAsync`": that contract is a separate agent's
 * and returns plain `Promise<T>` (see its own file comment for why — the
 * two-person rule is enforced by a database trigger and Cerbos, not by this
 * interface), so `LedgerInternalClient` extends it as-is rather than
 * wrapping it to match the rest of this file.
 */
export interface LedgerInternalClient extends LedgerSettingsOperations {
  // --- pricing ---
  quote(request: QuoteRequest): ResultAsync<Quote, LedgerError>;
  lockQuote(request: LockQuoteRequest): ResultAsync<Quote, LedgerError>;
  priceListing(request: PriceListingRequest): ResultAsync<PriceListingResult, LedgerError>;
  quotePurchase(request: QuotePurchaseRequest): ResultAsync<QuotePurchaseResult, LedgerError>;
  /** F61/TASKS.md 7.3.h: prices any positive point count at P_issue — no pack-multiple requirement. See the contract's own doc comment for why this is not `quotePurchase`. */
  valuePoints(request: ValuePointsRequest): ResultAsync<ValuePointsResult, LedgerError>;

  // --- funding and allocations ---
  purchasePoints(request: PurchasePointsRequest): ResultAsync<Allocation, LedgerError>;
  listAllocations(businessId: string): ResultAsync<readonly Allocation[], LedgerError>;
  getAllocation(allocationId: string): ResultAsync<Allocation, LedgerError>;
  hold(request: HoldRequest): ResultAsync<Hold, LedgerError>;
  consume(holdId: string): ResultAsync<Hold, LedgerError>;
  release(holdId: string): ResultAsync<Hold, LedgerError>;
  returnGrant(request: ReturnGrantRequest): ResultAsync<void, LedgerError>;
  campaignSpend(campaignId: string): ResultAsync<CampaignSpend, LedgerError>;

  // --- earning and spending ---
  grantReward(request: GrantRewardRequest): ResultAsync<Grant, LedgerError>;
  grantAction(request: GrantActionRequest): ResultAsync<Grant, LedgerError>;
  burnForVoucher(request: BurnForVoucherRequest): ResultAsync<Burn, LedgerError>;
  getBurn(sagaId: string): ResultAsync<Burn, LedgerError>;
  reinstateBurn(sagaId: string): ResultAsync<Burn, LedgerError>;
  /**
   * 4.6.f.2: posts a voucher capture to the merchant's payable, keyed on
   * captureId. Its real caller is services/voucher's outbox drainer, in Go.
   */
  captureVoucher(request: CaptureVoucherRequest): ResultAsync<CapturePosting, LedgerError>;

  // --- users ---
  escrow(request: EscrowRequest): ResultAsync<Escrow, LedgerError>;
  releaseEscrow(escrowId: string): ResultAsync<Escrow, LedgerError>;
  balance(userId: string): ResultAsync<LedgerBalance, LedgerError>;
  history(request: HistoryRequest): ResultAsync<readonly LedgerHistoryEntry[], LedgerError>;

  // --- risk (10.4/10.5) ---
  riskQueueList(request: RiskQueueListRequest): ResultAsync<RiskQueueList, LedgerError>;
  riskQueueRelease(request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError>;
  riskQueueSuspend(request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError>;

  // --- economy ---
  coverage(region: string): ResultAsync<Coverage, LedgerError>;
  economyDaily(request: EconomyDailyRequest): ResultAsync<readonly EconomyDayRow[], LedgerError>;
  proposeRate(request: ProposeRateRequest): ResultAsync<RateProposal, LedgerError>;
  approveRate(request: ApproveRateRequest): ResultAsync<RateProposal, LedgerError>;
  fundMarketing(request: FundMarketingRequest): ResultAsync<void, LedgerError>;
  /** 10.1.b: every statement apps/worker's weekly job has already generated for this business in [from, to). Never generates one itself. */
  statements(request: StatementsRequest): ResultAsync<readonly Statement[], LedgerError>;
  /** 10.6.b: the studio's own dispute — holds the payout until staff resolve it (10.6.a). */
  disputeStatement(request: DisputeStatementRequest): ResultAsync<Statement, LedgerError>;
  /** 10.5.a: staff releases a disputed statement back to `open`, e.g. after posting a recovery line. */
  resolveStatementDispute(
    request: ResolveStatementDisputeRequest,
  ): ResultAsync<Statement, LedgerError>;
  /** 10.5/10.6: every open or disputed statement in a region, oldest first — the staff queue. */
  statementQueue(region: string): ResultAsync<readonly Statement[], LedgerError>;
  /** 10.1.c: after the F12 dispute window, the statement's closing payable moves from the merchant's payable to the reserve. */
  approvePayout(request: ApprovePayoutRequest): ResultAsync<Statement, LedgerError>;
  /**
   * 10.5.b: resolving a captured-voucher K13 dispute in the user's favour
   * posts a recovery line against the merchant that captured it. Idempotent
   * per captureId — a capture can be recovered at most once.
   */
  recoverCapture(request: RecoverCaptureRequest): ResultAsync<CaptureRecoveryPosting, LedgerError>;
  /** 10.1.c/10.2.b: an expired voucher or a forfeited remainder never captured releases its own settlement value back. */
  releaseVoucherLiability(
    request: ReleaseVoucherLiabilityRequest,
  ): ResultAsync<{ transferId: string }, LedgerError>;
  /** 10.3.b: every day proved so far, oldest first (F11) — GET /api/proof/roots publishes this verbatim. */
  proofRoots(): ResultAsync<readonly ProvedDay[], LedgerError>;

  // --- dev/staging only (2.3.d/2.3.f) ---
  advanceHoldback(request: AdvanceHoldbackRequest): ResultAsync<AdvanceHoldbackResult, LedgerError>;
}

export const LEDGER_INTERNAL_CLIENT = Symbol("LEDGER_INTERNAL_CLIENT");
