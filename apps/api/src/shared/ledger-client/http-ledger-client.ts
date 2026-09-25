import type { ResultAsync } from "neverthrow";
import { ResultAsync as ResultAsyncCtor, err, ok } from "neverthrow";
import {
  ledgerError,
  ledgerErrorCodeSchema,
} from "@yourtal/contracts/ledger-internal/ledger-error";
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
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import type { ServiceCaller } from "@yourtal/contracts/ledger-internal/service-signature";
import type { AppDb } from "../persistence/drizzle-client";
import * as settings from "./fake/fake-ledger-settings";
import type { LedgerInternalClient } from "./ledger-internal-client";

/** The services allowed to sign a ledger call (services/ledger/internal/serviceauth). */
export type LedgerCaller = ServiceCaller;

/**
 * The live ledger client (1.2.d, 4.1.c). Every call is a POST signed the way
 * `services/ledger/internal/serviceauth` verifies it: HMAC-SHA256 over
 * timestamp, caller, nonce, method, path with query, and the body's SHA-256,
 * newline-joined. A refusal the contract names comes back as its closed
 * ledger-error code; any other failure rejects, because it is not a decision
 * a caller can act on.
 *
 * Settings are not the ledger's to serve: they live in apps/api's own
 * `platform.region_setting`, so they go straight to the same store the fake
 * uses (1.2.f).
 */
export class HttpLedgerClient implements LedgerInternalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly db: AppDb,
    private readonly caller: LedgerCaller = "api",
  ) {}

  /** The X-YourTal-Service-Signature header for one request. */
  private sign(path: string, body: string): string {
    return signServiceRequest({
      secret: this.secret,
      caller: this.caller,
      method: "POST",
      pathAndQuery: path,
      body,
    });
  }

  private async send(path: string, body: unknown): Promise<Response> {
    const payload = JSON.stringify(body);
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SERVICE_SIGNATURE_HEADER]: this.sign(path, payload),
      },
      body: payload,
    });
  }

  private post<T>(path: string, body: unknown): ResultAsync<T, LedgerError> {
    return new ResultAsyncCtor(
      (async () => {
        const response = await this.send(path, body);
        if (response.ok) {
          return ok((await response.json()) as T);
        }
        const problem: unknown = await response.json().catch(() => null);
        const refusal =
          problem !== null && typeof problem === "object"
            ? (problem as Record<string, unknown>)
            : {};
        const code = ledgerErrorCodeSchema.safeParse(refusal["code"]);
        if (code.success) {
          const message = refusal["message"];
          return err(
            ledgerError(
              code.data,
              typeof message === "string" && message !== "" ? message : code.data,
            ),
          );
        }
        throw new Error(
          `ledger ${path} answered ${String(response.status)}: ${JSON.stringify(problem)}`,
        );
      })(),
    );
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
    return settings.getSettings(this.db, region);
  }

  proposeSetting(input: ProposeSettingInput): Promise<RegionSetting> {
    return settings.proposeSetting(this.db, input);
  }

  approveSetting(input: ApproveSettingInput): Promise<RegionSetting> {
    return settings.approveSetting(this.db, input);
  }
}
