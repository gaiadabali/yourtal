import type { ResultAsync } from "neverthrow";
import { okAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
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
import type { Region } from "@yourtal/contracts/region";
import type {
  ApproveSettingInput,
  ProposeSettingInput,
  RegionSetting,
} from "@yourtal/contracts/ledger-internal/settings";
import type { AppDb } from "../persistence/drizzle-client";
import type { LedgerInternalClient } from "./ledger-internal-client";
import * as pricing from "./fake/fake-ledger-pricing";
import * as funding from "./fake/fake-ledger-funding";
import * as rewards from "./fake/fake-ledger-rewards";
import * as wallet from "./fake/fake-ledger-wallet";
import * as risk from "./fake/fake-ledger-risk";
import * as economy from "./fake/fake-ledger-economy";
import * as settings from "./fake/fake-ledger-settings";
import * as capture from "./fake/fake-ledger-capture";
import * as dev from "./fake/fake-ledger-dev";

/**
 * TASKS.md 1.2.d. Real semantics against `platform.ledger_fake_*`, shared by
 * apps/api and apps/worker through the one database both already connect to
 * — not a per-process in-memory map, which two workers would each keep their
 * own copy of. `LEDGER_MODE=fake` picks this; `createLedgerClient.ts` is
 * where that switch lives.
 */
export class FakeLedgerClient implements LedgerInternalClient {
  constructor(private readonly db: AppDb) {}

  quote(request: QuoteRequest): ResultAsync<Quote, LedgerError> {
    return pricing.quote(this.db, request);
  }

  lockQuote(request: LockQuoteRequest): ResultAsync<Quote, LedgerError> {
    return pricing.lockQuote(this.db, request);
  }

  priceListing(request: PriceListingRequest): ResultAsync<PriceListingResult, LedgerError> {
    return pricing.priceListing(this.db, request);
  }

  quotePurchase(request: QuotePurchaseRequest): ResultAsync<QuotePurchaseResult, LedgerError> {
    return pricing.quotePurchase(request);
  }

  valuePoints(request: ValuePointsRequest): ResultAsync<ValuePointsResult, LedgerError> {
    return pricing.valuePoints(request);
  }

  purchasePoints(request: PurchasePointsRequest): ResultAsync<Allocation, LedgerError> {
    return funding.purchasePoints(this.db, request);
  }

  listAllocations(businessId: string): ResultAsync<readonly Allocation[], LedgerError> {
    return funding.listAllocations(this.db, businessId);
  }

  getAllocation(allocationId: string): ResultAsync<Allocation, LedgerError> {
    return funding.getAllocation(this.db, allocationId);
  }

  hold(request: HoldRequest): ResultAsync<Hold, LedgerError> {
    return funding.hold(this.db, request);
  }

  consume(holdId: string): ResultAsync<Hold, LedgerError> {
    return funding.consume(this.db, holdId);
  }

  release(holdId: string): ResultAsync<Hold, LedgerError> {
    return funding.release(this.db, holdId);
  }

  returnGrant(request: ReturnGrantRequest): ResultAsync<void, LedgerError> {
    return funding.returnGrant(this.db, request);
  }

  campaignSpend(campaignId: string): ResultAsync<CampaignSpend, LedgerError> {
    return funding.campaignSpend(this.db, campaignId);
  }

  grantReward(request: GrantRewardRequest): ResultAsync<Grant, LedgerError> {
    return rewards.grantReward(this.db, request);
  }

  grantAction(request: GrantActionRequest): ResultAsync<Grant, LedgerError> {
    return rewards.grantAction(this.db, request);
  }

  burnForVoucher(request: BurnForVoucherRequest): ResultAsync<Burn, LedgerError> {
    return rewards.burnForVoucher(this.db, request);
  }

  getBurn(sagaId: string): ResultAsync<Burn, LedgerError> {
    return rewards.getBurn(this.db, sagaId);
  }

  reinstateBurn(sagaId: string): ResultAsync<Burn, LedgerError> {
    return rewards.reinstateBurn(this.db, sagaId);
  }

  captureVoucher(request: CaptureVoucherRequest): ResultAsync<CapturePosting, LedgerError> {
    return capture.captureVoucher(this.db, request);
  }

  escrow(request: EscrowRequest): ResultAsync<Escrow, LedgerError> {
    return wallet.escrow(this.db, request);
  }

  releaseEscrow(escrowId: string): ResultAsync<Escrow, LedgerError> {
    return wallet.releaseEscrow(this.db, escrowId);
  }

  balance(userId: string): ResultAsync<LedgerBalance, LedgerError> {
    return wallet.balance(this.db, userId);
  }

  history(request: HistoryRequest): ResultAsync<readonly LedgerHistoryEntry[], LedgerError> {
    return wallet.history(this.db, request);
  }

  riskQueueList(request: RiskQueueListRequest): ResultAsync<RiskQueueList, LedgerError> {
    return risk.riskQueueList(this.db, request);
  }

  riskQueueRelease(request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError> {
    return risk.riskQueueRelease(this.db, request);
  }

  riskQueueSuspend(request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError> {
    return risk.riskQueueSuspend(this.db, request);
  }

  coverage(region: string): ResultAsync<Coverage, LedgerError> {
    return economy.coverage(this.db, region);
  }

  economyDaily(request: EconomyDailyRequest): ResultAsync<readonly EconomyDayRow[], LedgerError> {
    return economy.economyDaily(this.db, request);
  }

  proposeRate(request: ProposeRateRequest): ResultAsync<RateProposal, LedgerError> {
    return economy.proposeRate(this.db, request);
  }

  approveRate(request: ApproveRateRequest): ResultAsync<RateProposal, LedgerError> {
    return economy.approveRate(this.db, request);
  }

  fundMarketing(request: FundMarketingRequest): ResultAsync<void, LedgerError> {
    return economy.fundMarketing(this.db, request);
  }

  statements(request: StatementsRequest): ResultAsync<readonly Statement[], LedgerError> {
    return economy.statements(this.db, request);
  }

  disputeStatement(request: DisputeStatementRequest): ResultAsync<Statement, LedgerError> {
    return economy.disputeStatement(this.db, request);
  }

  resolveStatementDispute(
    request: ResolveStatementDisputeRequest,
  ): ResultAsync<Statement, LedgerError> {
    return economy.resolveStatementDispute(this.db, request);
  }

  statementQueue(region: string): ResultAsync<readonly Statement[], LedgerError> {
    return economy.statementQueue(this.db, region);
  }

  approvePayout(request: ApprovePayoutRequest): ResultAsync<Statement, LedgerError> {
    return economy.approvePayout(this.db, request);
  }

  recoverCapture(request: RecoverCaptureRequest): ResultAsync<CaptureRecoveryPosting, LedgerError> {
    return capture.recoverCapture(this.db, request);
  }

  releaseVoucherLiability(
    request: ReleaseVoucherLiabilityRequest,
  ): ResultAsync<{ transferId: string }, LedgerError> {
    return economy.releaseVoucherLiability(this.db, request);
  }

  /**
   * 10.3.b: the fake never computes a Merkle root at all (that machinery is
   * services/ledger's own, 10.3.a) — always empty, same tier as `coverage`'s
   * "illustrative, not the real books" note on this file's economy module.
   */
  proofRoots(): ResultAsync<readonly ProvedDay[], LedgerError> {
    return okAsync([]);
  }

  advanceHoldback(
    request: AdvanceHoldbackRequest,
  ): ResultAsync<AdvanceHoldbackResult, LedgerError> {
    return dev.advanceHoldback(this.db, request);
  }

  // --- settings (1.2.f/1.2.g) ---

  getSettings(region: Region): Promise<readonly RegionSetting[]> {
    return settings.getSettings(this.db, region);
  }

  proposeSetting(input: ProposeSettingInput): Promise<RegionSetting> {
    return settings.proposeSetting(this.db, input);
  }

  approveSetting(input: ApproveSettingInput): Promise<RegionSetting> {
    return settings.approveSetting(this.db, input);
  }
}
