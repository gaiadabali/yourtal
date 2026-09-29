import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { Region } from "@yourtal/contracts/region";
import { REGION_CONFIG } from "@yourtal/contracts/region";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type {
  EconomyOverview,
  EconomyProposal,
  RateScreen,
  SettingsScreen,
} from "@yourtal/contracts/staff/economy";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import { BUSINESS_REGION_LOOKUP } from "../../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../../store/persistence/business-region-lookup";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../../shared/authz/authz-error.mapper";
import { PDP_CLIENT } from "../../../shared/pdp/pdp-client.module";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff-action.decorator";
import {
  DecideProposalDto,
  ProposeManualPurchaseDto,
  ProposeMarketingFundingDto,
  ProposeRateDto,
  ProposeSettingDto,
  TripKillSwitchDto,
} from "./dto/economy.dto";
import { currentBackingRateMicros, reportedSpreadMinor } from "./coverage-math";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposal,
} from "./persistence/economy-proposal.repository";
import type {
  EconomyProposalRepository,
  EconomyProposalRow,
} from "./persistence/economy-proposal.repository";
import { mapLedgerErrorToHttpException } from "./to-http-exception";

const ECONOMY_RETENTION_MS = 24 * 60 * 60 * 1000;

function parseRegion(raw: string): Region {
  if (raw !== "AU" && raw !== "ID") {
    throw new BadRequestException({ code: "unknown_region", message: `unknown region ${raw}` });
  }
  return raw;
}

/**
 * TASKS.md 9.5: the staff console's economy screens -- coverage and daily
 * issuance/reserve/spread (9.5.a), rate changes (9.5.b, B never leaves the
 * rate screen), marketing funding and manual point purchases (9.5.c, both
 * two-person), and every F12 setting per region including points expiry
 * (9.5.d). Every route sits under `api/staff/economy`, alongside
 * `api/staff/me` (9.1) -- staff routes are never tenant-scoped.
 *
 * Every mutating route follows `StoreListingController.setSettlementValue`'s
 * two-step shape: `@Authorize` proves the caller may act on THIS resource
 * kind AT ALL (a synchronous, request-only check), and an approval route
 * additionally makes a second, explicit `pdp.requireAction` call once the
 * proposal's real `proposedBy` is known from a DB read -- which is the only
 * way `nobody-approves-their-own-adjustment` /
 * `nobody-approves-their-own-setting-proposal` can ever see the real
 * attribute, since `attrsFrom` runs before any repository call.
 */
@Controller("api/staff/economy")
export class StaffEconomyController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(BUSINESS_REGION_LOOKUP) private readonly businessRegionLookup: BusinessRegionLookup,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
  ) {}

  // -- 9.5.a: overview --------------------------------------------------

  @Authorize({ kind: "platform_setting", action: "view_setting", idFrom: () => "economy-overview" })
  @StaffAction("economy.view_overview")
  @NotValueMoving("A read.")
  @Get(":region/overview")
  async overview(
    @Param("region") regionParam: string,
    @Req() request: FastifyRequest,
  ): Promise<EconomyOverview> {
    const region = parseRegion(regionParam);
    const coverageResult = await this.ledger.coverage(region);
    if (coverageResult.isErr()) throw mapLedgerErrorToHttpException(coverageResult.error);
    const coverage = coverageResult.value;

    const to = new Date();
    const from = new Date(to.getTime() - 13 * 24 * 60 * 60 * 1000);
    const dailyResult = await this.ledger.economyDaily({
      region,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    if (dailyResult.isErr()) throw mapLedgerErrorToHttpException(dailyResult.error);

    const purchases = await this.proposals.listAll(region, "manual_purchase");

    setStaffAuditContext(request, { targetKind: "region", targetId: region, region });

    return {
      region,
      coverage,
      dailySeries: dailyResult.value.map((row) => ({
        date: row.date,
        pointsIssued: row.pointsIssued,
        pointsRedeemed: row.pointsRedeemed,
      })),
      reportedSpread: {
        amountMinor: reportedSpreadMinor(coverage),
        currency: REGION_CONFIG[region].currency,
      },
      manualPurchases: purchases.map(toEconomyProposal),
    };
  }

  // -- 9.5.b: rate management -- finance only, B never leaves this screen --

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "rate",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.view_rate")
  @NotValueMoving("A read.")
  @Get(":region/rate")
  async rateScreen(@Param("region") regionParam: string): Promise<RateScreen> {
    const region = parseRegion(regionParam);
    const coverageResult = await this.ledger.coverage(region);
    if (coverageResult.isErr()) throw mapLedgerErrorToHttpException(coverageResult.error);
    const pending = await this.proposals.listPending(region, "rate_change");
    return {
      region,
      currency: REGION_CONFIG[region].currency,
      currentBackingRateMicrosPerPoint: currentBackingRateMicros(coverageResult.value),
      pending: pending.map(toEconomyProposal),
    };
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "create",
    idFrom: () => "new",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.propose_rate")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/rate/proposals")
  async proposeRate(
    @Param("region") regionParam: string,
    @Body() body: ProposeRateDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const currency = REGION_CONFIG[region].currency;

    const result = await this.ledger.proposeRate({
      region,
      currency,
      backingRateMicrosPerPoint: body.backingRateMicrosPerPoint,
      proposedBy: principal.id,
    });
    if (result.isErr()) throw mapLedgerErrorToHttpException(result.error);

    const row = await this.proposals.create({
      kind: "rate_change",
      region,
      summary: `Backing rate change (proposal ${result.value.proposalId})`,
      payload: { ledgerRef: result.value.proposalId, currency },
      proposedBy: principal.id,
      reason: body.reason,
    });
    setStaffAuditContext(request, {
      targetKind: "rate_proposal",
      targetId: row.id,
      region,
      ...reasonAttr(body.reason),
    });
    return toEconomyProposal(row);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.approve_rate")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/rate/proposals/:id/approve")
  async approveRate(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requireProposal(id, region, "rate_change");

    const ledgerRef = (row.payload as { ledgerRef?: string }).ledgerRef;
    if (typeof ledgerRef !== "string") {
      throw new BadRequestException({ code: "invalid_proposal", message: "no ledger reference" });
    }

    // Real two-person check: `attrsFrom` cannot see `row.proposedBy` (a DB
    // read), so the coarse `@Authorize` above only proved "this principal is
    // finance at all". This is what actually refuses a self-approval.
    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id, attr: { createdBy: row.proposedBy } },
      "approve",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const approveResult = await this.ledger.approveRate({
      proposalId: ledgerRef,
      approvedBy: principal.id,
    });
    if (approveResult.isErr()) throw mapLedgerErrorToHttpException(approveResult.error);

    const decided = await this.proposals.approve(
      row.id,
      principal.id,
      approveResult.value,
      body.note,
    );
    setStaffAuditContext(request, { targetKind: "rate_proposal", targetId: row.id, region });
    return toEconomyProposal(decided);
  }

  // -- 9.5.c: marketing funding -- two-person --

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "marketing",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.view_marketing_fundings")
  @NotValueMoving("A read.")
  @Get(":region/marketing-fundings")
  async marketingFundings(
    @Param("region") regionParam: string,
  ): Promise<readonly EconomyProposal[]> {
    const region = parseRegion(regionParam);
    const rows = await this.proposals.listAll(region, "fund_marketing");
    return rows.map(toEconomyProposal);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "create",
    idFrom: () => "new",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.propose_marketing_funding")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/marketing-fundings")
  async proposeMarketingFunding(
    @Param("region") regionParam: string,
    @Body() body: ProposeMarketingFundingDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const currency = REGION_CONFIG[region].currency;

    const row = await this.proposals.create({
      kind: "fund_marketing",
      region,
      summary: `Marketing funding of ${String(body.amountMinor)} ${currency} minor units`,
      payload: { amountMinor: body.amountMinor, currency },
      proposedBy: principal.id,
      reason: body.reason,
    });
    setStaffAuditContext(request, {
      targetKind: "marketing_funding",
      targetId: row.id,
      region,
      reason: body.reason,
    });
    return toEconomyProposal(row);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.approve_marketing_funding")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/marketing-fundings/:id/approve")
  async approveMarketingFunding(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requireProposal(id, region, "fund_marketing");

    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id, attr: { createdBy: row.proposedBy } },
      "approve",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const payload = row.payload as { amountMinor: number; currency: "AUD" | "IDR" };
    const fundResult = await this.ledger.fundMarketing({
      region,
      amountMinor: toMinorUnits(payload.amountMinor),
      proposedBy: row.proposedBy,
      approvedBy: principal.id,
    });
    if (fundResult.isErr()) throw mapLedgerErrorToHttpException(fundResult.error);

    const decided = await this.proposals.approve(row.id, principal.id, { funded: true }, body.note);
    setStaffAuditContext(request, { targetKind: "marketing_funding", targetId: row.id, region });
    return toEconomyProposal(decided);
  }

  // -- 9.5.c: manual point purchase -- two-person, bank-transfer reference --

  @Authorize({
    kind: "ledger_adjustment",
    action: "create",
    idFrom: () => "new",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.propose_purchase")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/purchases")
  async proposeManualPurchase(
    @Param("region") regionParam: string,
    @Body() body: ProposeManualPurchaseDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const currency = REGION_CONFIG[region].currency;

    const business = await this.businessRegionLookup.findRegionAndCurrency(body.businessId);
    if (business === null) {
      throw new NotFoundException({ code: "business_not_found", message: "no such business" });
    }
    if (business.region !== region) {
      throw new BadRequestException({
        code: "region_mismatch",
        message: `business ${body.businessId} is in ${business.region}, not ${region}`,
      });
    }

    const row = await this.proposals.create({
      kind: "manual_purchase",
      region,
      summary: `Manual purchase: ${String(body.points)} pts for business ${body.businessId} (ref ${body.bankReference})`,
      payload: {
        businessId: body.businessId,
        points: body.points,
        paidMinor: body.paidMinor,
        currency,
        bankReference: body.bankReference,
      },
      proposedBy: principal.id,
      ...reasonAttr(body.reason),
    });
    setStaffAuditContext(request, {
      targetKind: "manual_purchase",
      targetId: row.id,
      region,
      ...reasonAttr(body.reason),
      detail: { businessId: body.businessId, bankReference: body.bankReference },
    });
    return toEconomyProposal(row);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy` is a REQUIRED
    // field on this resource kind, so even this coarse, request-only check must supply
    // one -- a placeholder here, since the real value needs a DB read the approve routes
    // do explicitly below. Only `approve`'s self-check below is security-relevant.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.approve_purchase")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/purchases/:id/approve")
  async approveManualPurchase(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requireProposal(id, region, "manual_purchase");

    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id, attr: { createdBy: row.proposedBy } },
      "approve",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const payload = row.payload as {
      businessId: string;
      points: number;
      paidMinor: number;
      currency: "AUD" | "IDR";
    };
    const purchaseResult = await this.ledger.purchasePoints({
      businessId: payload.businessId,
      region,
      currency: payload.currency,
      points: toPoints(payload.points),
      paidMinor: toMinorUnits(payload.paidMinor),
      // Scoped per proposal, so replaying this approval never double-purchases.
      idempotencyKey: `staff-economy:manual-purchase:${row.id}`,
    });
    if (purchaseResult.isErr()) throw mapLedgerErrorToHttpException(purchaseResult.error);

    const decided = await this.proposals.approve(
      row.id,
      principal.id,
      purchaseResult.value,
      body.note,
    );
    setStaffAuditContext(request, { targetKind: "manual_purchase", targetId: row.id, region });
    return toEconomyProposal(decided);
  }

  // -- 9.5.d: every F12 setting, per region, plus points expiry (F2) --

  @Authorize({ kind: "platform_setting", action: "view_setting", idFrom: () => "region_setting.*" })
  @StaffAction("economy.view_settings")
  @NotValueMoving("A read.")
  @Get(":region/settings")
  async settingsScreen(@Param("region") regionParam: string): Promise<SettingsScreen> {
    const region = parseRegion(regionParam);
    const current = await this.ledger.getSettings(region);
    const pending = await this.proposals.listPending(region, "setting_change");
    return { region, current: [...current], pending: pending.map(toEconomyProposal) };
  }

  @Authorize({
    kind: "platform_setting",
    action: "propose_setting",
    idFrom: () => "new",
    attrsFrom: (request) => ({ key: `region_setting.${readBodyKey(request)}` }),
  })
  @StaffAction("economy.propose_setting")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/settings/proposals")
  async proposeSetting(
    @Param("region") regionParam: string,
    @Body() body: ProposeSettingDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);

    const setting = await this.ledger.proposeSetting({
      region,
      key: body.key,
      value: body.value,
      proposedBy: principal.id,
    });

    const row = await this.proposals.create({
      kind: "setting_change",
      region,
      summary: `${body.key} -> ${JSON.stringify(body.value)}`,
      payload: { ledgerRef: setting.id, key: body.key, value: body.value },
      proposedBy: principal.id,
      reason: body.reason,
    });
    setStaffAuditContext(request, {
      targetKind: "region_setting",
      targetId: row.id,
      region,
      ...reasonAttr(body.reason),
      detail: { key: body.key },
    });
    return toEconomyProposal(row);
  }

  @Authorize({ kind: "platform_setting", action: "approve_setting" })
  @StaffAction("economy.approve_setting")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post(":region/settings/proposals/:id/approve")
  async approveSetting(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requireProposal(id, region, "setting_change");

    const payload = row.payload as { ledgerRef: string; key: string };
    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "platform_setting",
        id,
        attr: { key: `region_setting.${payload.key}`, proposedBy: row.proposedBy },
      },
      "approve_setting",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const setting = await this.ledger.approveSetting({
      id: payload.ledgerRef,
      approvedBy: principal.id,
    });

    const decided = await this.proposals.approve(row.id, principal.id, setting, body.note);
    setStaffAuditContext(request, {
      targetKind: "region_setting",
      targetId: row.id,
      region,
      detail: { key: payload.key },
    });
    return toEconomyProposal(decided);
  }

  // -- 9.5.c: kill switches -- ops only, single action, auditable ---------

  @Authorize({ kind: "platform_setting", action: "view", idFrom: () => "kill-switches" })
  @StaffAction("economy.view_kill_switches")
  @NotValueMoving("A read.")
  @Get("kill-switches")
  async killSwitches() {
    const result = await this.vouchers.listKillSwitches();
    if (result.isErr()) throw mapLedgerErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "platform_setting", action: "trip_kill_switch", idFrom: () => "new" })
  @StaffAction("economy.trip_kill_switch")
  @Idempotent({ retentionMs: ECONOMY_RETENTION_MS })
  @Post("kill-switches")
  async tripKillSwitch(@Body() body: TripKillSwitchDto, @Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const result = await this.vouchers.setKillSwitch({
      scope: body.scope,
      targetId: body.targetId,
      reason: body.reason,
      active: body.active,
      setBy: principal.id,
    });
    if (result.isErr()) throw mapLedgerErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "kill_switch",
      targetId: result.value.killSwitchId,
      reason: body.reason,
      detail: { scope: body.scope, targetId: body.targetId, active: body.active },
    });
    return result.value;
  }

  private async requireProposal(
    id: string,
    region: Region,
    kind: "rate_change" | "fund_marketing" | "manual_purchase" | "setting_change",
  ): Promise<EconomyProposalRow> {
    const row = await this.proposals.findById(id);
    if (row === null || row.region !== region || row.kind !== kind) {
      throw new NotFoundException({
        code: "proposal_not_found",
        message: `no ${kind} proposal ${id}`,
      });
    }
    if (row.status !== "pending") {
      throw new BadRequestException({
        code: "already_decided",
        message: `proposal ${id} is already ${row.status}`,
      });
    }
    return row;
  }
}

/**
 * `propose_setting`'s `attrsFrom` runs before the body becomes a validated
 * DTO, so it reads the raw request body directly -- same shape
 * `team-member.controller.ts`'s own `readBodyField` uses. A missing/wrong-
 * typed `key` reads as `"unknown"`, which matches no real `region_setting.*`
 * key and so is refused by every policy rule that checks it, never asserted
 * into a real key by this function.
 */
/** `exactOptionalPropertyTypes`: an optional `reason` field must be OMITTED, not present-as-`undefined`. */
function reasonAttr(reason: string | undefined): { reason: string } | Record<string, never> {
  return reason === undefined ? {} : { reason };
}

function readBodyKey(request: FastifyRequest): string {
  const body: unknown = request.body;
  if (typeof body !== "object" || body === null) return "unknown";
  const value: unknown = Reflect.get(body, "key");
  return typeof value === "string" ? value : "unknown";
}
