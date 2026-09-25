import type { ResultAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
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
import type { AppDb } from "../persistence/drizzle-client";
import type { LedgerInternalClient } from "./ledger-internal-client";
import * as pricing from "./fake/fake-ledger-pricing";
import * as funding from "./fake/fake-ledger-funding";
import * as rewards from "./fake/fake-ledger-rewards";
import * as wallet from "./fake/fake-ledger-wallet";
import * as economy from "./fake/fake-ledger-economy";

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

  statements(request: StatementsRequest): ResultAsync<never, LedgerError> {
    return economy.statements(request);
  }

  approvePayout(request: ApprovePayoutRequest): ResultAsync<never, LedgerError> {
    return economy.approvePayout(request);
  }
}
