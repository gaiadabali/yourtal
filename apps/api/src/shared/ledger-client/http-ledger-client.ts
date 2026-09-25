import type { ResultAsync } from "neverthrow";
import { ResultAsync as ResultAsyncCtor, err, ok } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
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
import type { Region } from "@yourtal/contracts/region";
import type {
  ApproveSettingInput,
  ProposeSettingInput,
  RegionSetting,
} from "@yourtal/contracts/ledger-internal/settings";
import type { LedgerInternalClient } from "./ledger-internal-client";

/**
 * TASKS.md 1.2.d's HTTP half. Every method POSTs to the ledger service and
 * decodes its JSON response — real plumbing, but nothing on the other end
 * yet: `services/ledger/internal/api/routes.go` answers every route with a
 * 501 `notYetExposed` until 4.1 builds them and the HMAC service-auth 4.1.a
 * asks for. Until then this client is exercised only by `it.todo` cases in
 * `ledger-client.contract.spec.ts` (1.2.e) — `LEDGER_MODE=fake` is what
 * actually runs today.
 */
export class HttpLedgerClient implements LedgerInternalClient {
  constructor(private readonly baseUrl: string) {}

  private post<T>(path: string, body: unknown): ResultAsync<T, LedgerError> {
    return new ResultAsyncCtor(
      (async () => {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const problem: unknown = await response.json().catch(() => null);
          const code =
            problem !== null && typeof problem === "object" && "code" in problem
              ? String((problem as Record<string, unknown>)["code"])
              : "unknown";
          return err(ledgerError("region_mismatch", `ledger service refused: ${code}`));
        }
        return ok((await response.json()) as T);
      })(),
    );
  }

  /**
   * `getSettings`/`proposeSetting`/`approveSetting` (1.2.f) are plain
   * `Promise<T>` in their own contract, not `ResultAsync` — see
   * `ledger-internal-client.ts`'s class comment — so this rejects on
   * failure rather than resolving to an `err(...)`, the ordinary fetch
   * failure shape every other caller of a plain-Promise API already expects.
   */
  private async postPlain<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const problem: unknown = await response.json().catch(() => null);
      throw new Error(`ledger service refused ${path}: ${JSON.stringify(problem)}`);
    }
    return (await response.json()) as T;
  }

  quote(request: QuoteRequest): ResultAsync<Quote, LedgerError> {
    return this.post("/v1/pricing/quote", request);
  }

  lockQuote(request: LockQuoteRequest): ResultAsync<Quote, LedgerError> {
    return this.post("/v1/pricing/quote/lock", request);
  }

  priceListing(request: PriceListingRequest): ResultAsync<PriceListingResult, LedgerError> {
    return this.post("/v1/pricing/listing", request);
  }

  quotePurchase(request: QuotePurchaseRequest): ResultAsync<QuotePurchaseResult, LedgerError> {
    return this.post("/v1/pricing/purchase-quote", request);
  }

  purchasePoints(request: PurchasePointsRequest): ResultAsync<Allocation, LedgerError> {
    return this.post("/v1/allocations/purchase", request);
  }

  listAllocations(businessId: string): ResultAsync<readonly Allocation[], LedgerError> {
    return this.post("/v1/allocations/list", { businessId });
  }

  getAllocation(allocationId: string): ResultAsync<Allocation, LedgerError> {
    return this.post("/v1/allocations/get", { allocationId });
  }

  hold(request: HoldRequest): ResultAsync<Hold, LedgerError> {
    return this.post("/v1/allocations/hold", request);
  }

  consume(holdId: string): ResultAsync<Hold, LedgerError> {
    return this.post("/v1/allocations/hold/consume", { holdId });
  }

  release(holdId: string): ResultAsync<Hold, LedgerError> {
    return this.post("/v1/allocations/hold/release", { holdId });
  }

  returnGrant(request: ReturnGrantRequest): ResultAsync<void, LedgerError> {
    return this.post("/v1/grants/return", request);
  }

  campaignSpend(campaignId: string): ResultAsync<CampaignSpend, LedgerError> {
    return this.post("/v1/campaigns/spend", { campaignId });
  }

  grantReward(request: GrantRewardRequest): ResultAsync<Grant, LedgerError> {
    return this.post("/v1/rewards/grants", request);
  }

  grantAction(request: GrantActionRequest): ResultAsync<Grant, LedgerError> {
    return this.post("/v1/actions/grants", request);
  }

  burnForVoucher(request: BurnForVoucherRequest): ResultAsync<Burn, LedgerError> {
    return this.post("/v1/burns", request);
  }

  getBurn(sagaId: string): ResultAsync<Burn, LedgerError> {
    return this.post("/v1/burns/get", { sagaId });
  }

  reinstateBurn(sagaId: string): ResultAsync<Burn, LedgerError> {
    return this.post("/v1/burns/reinstate", { sagaId });
  }

  escrow(request: EscrowRequest): ResultAsync<Escrow, LedgerError> {
    return this.post("/v1/escrow", request);
  }

  releaseEscrow(escrowId: string): ResultAsync<Escrow, LedgerError> {
    return this.post("/v1/escrow/release", { escrowId });
  }

  balance(userId: string): ResultAsync<LedgerBalance, LedgerError> {
    return this.post("/v1/wallet/balance", { userId });
  }

  history(request: HistoryRequest): ResultAsync<readonly LedgerHistoryEntry[], LedgerError> {
    return this.post("/v1/wallet/history", request);
  }

  coverage(region: string): ResultAsync<Coverage, LedgerError> {
    return this.post("/v1/economy/coverage", { region });
  }

  economyDaily(request: EconomyDailyRequest): ResultAsync<readonly EconomyDayRow[], LedgerError> {
    return this.post("/v1/economy/daily", request);
  }

  proposeRate(request: ProposeRateRequest): ResultAsync<RateProposal, LedgerError> {
    return this.post("/v1/economy/rates/propose", request);
  }

  approveRate(request: ApproveRateRequest): ResultAsync<RateProposal, LedgerError> {
    return this.post("/v1/economy/rates/approve", request);
  }

  fundMarketing(request: FundMarketingRequest): ResultAsync<void, LedgerError> {
    return this.post("/v1/economy/marketing/fund", request);
  }

  statements(request: StatementsRequest): ResultAsync<never, LedgerError> {
    return this.post("/v1/economy/statements", request);
  }

  approvePayout(request: ApprovePayoutRequest): ResultAsync<never, LedgerError> {
    return this.post("/v1/economy/payouts/approve", request);
  }

  // --- settings (1.2.f/1.2.g) ---

  getSettings(region: Region): Promise<readonly RegionSetting[]> {
    return this.postPlain("/v1/settings/list", { region });
  }

  proposeSetting(input: ProposeSettingInput): Promise<RegionSetting> {
    return this.postPlain("/v1/settings/propose", input);
  }

  approveSetting(input: ApproveSettingInput): Promise<RegionSetting> {
    return this.postPlain("/v1/settings/approve", input);
  }
}
