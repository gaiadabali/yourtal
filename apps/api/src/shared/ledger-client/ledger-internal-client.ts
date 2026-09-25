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
  Escrow,
  EscrowRequest,
  HistoryRequest,
  LedgerBalance,
  LedgerHistoryEntry,
} from "@yourtal/contracts/ledger-internal/wallet";
import type {
  ApproveRateRequest,
  ApprovePayoutRequest,
  Coverage,
  EconomyDailyRequest,
  EconomyDayRow,
  FundMarketingRequest,
  ProposeRateRequest,
  RateProposal,
  StatementsRequest,
} from "@yourtal/contracts/ledger-internal/economy";

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

  // --- users ---
  escrow(request: EscrowRequest): ResultAsync<Escrow, LedgerError>;
  releaseEscrow(escrowId: string): ResultAsync<Escrow, LedgerError>;
  balance(userId: string): ResultAsync<LedgerBalance, LedgerError>;
  history(request: HistoryRequest): ResultAsync<readonly LedgerHistoryEntry[], LedgerError>;

  // --- economy ---
  coverage(region: string): ResultAsync<Coverage, LedgerError>;
  economyDaily(request: EconomyDailyRequest): ResultAsync<readonly EconomyDayRow[], LedgerError>;
  proposeRate(request: ProposeRateRequest): ResultAsync<RateProposal, LedgerError>;
  approveRate(request: ApproveRateRequest): ResultAsync<RateProposal, LedgerError>;
  fundMarketing(request: FundMarketingRequest): ResultAsync<void, LedgerError>;
  /** `not_implemented` (as a `LedgerError`-shaped rejection) until 10.1. */
  statements(request: StatementsRequest): ResultAsync<never, LedgerError>;
  /** `not_implemented` until 10.1. */
  approvePayout(request: ApprovePayoutRequest): ResultAsync<never, LedgerError>;
}

export const LEDGER_INTERNAL_CLIENT = Symbol("LEDGER_INTERNAL_CLIENT");
