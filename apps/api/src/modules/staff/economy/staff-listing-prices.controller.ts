import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type {
  EconomyProposal,
  ListingPriceRow,
  ListingPricesScreen,
} from "@yourtal/contracts/staff/economy";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../../shared/authz/authz-error.mapper";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { PDP_CLIENT } from "../../../shared/pdp/pdp-client.module";
import { withStaffPrice } from "../../store/persistence/listing-live-values";
import { emailsOf, STAFF_DIRECTORY } from "../persistence/staff-directory";
import type { StaffDirectory } from "../persistence/staff-directory";
import { StaffAction, setStaffAuditContext } from "../staff-action.decorator";
import { DecideProposalDto, ProposeListingPriceDto } from "./dto/economy.dto";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposal,
  toEconomyProposalWithEmail,
} from "./persistence/economy-proposal.repository";
import type {
  EconomyProposalRepository,
  EconomyProposalRow,
} from "./persistence/economy-proposal.repository";
import { LISTING_PRICE_REPOSITORY } from "./persistence/listing-price.repository";
import type {
  ListingPriceFacts,
  ListingPriceRepository,
} from "./persistence/listing-price.repository";

const RETENTION_MS = 24 * 60 * 60 * 1000;

interface PricePayload {
  readonly listingId: string;
  readonly minPricePoints: number | null;
  readonly previous: number | null;
}

function parseRegion(raw: string): Region {
  if (raw !== "AU" && raw !== "ID") {
    throw new BadRequestException({ code: "unknown_region", message: `unknown region ${raw}` });
  }
  return raw;
}

function payloadOf(row: EconomyProposalRow): PricePayload {
  const payload = row.payload as Partial<PricePayload>;
  if (typeof payload.listingId !== "string") {
    throw new BadRequestException({ code: "invalid_proposal", message: "no listing" });
  }
  return {
    listingId: payload.listingId,
    minPricePoints: typeof payload.minPricePoints === "number" ? payload.minPricePoints : null,
    previous: typeof payload.previous === "number" ? payload.previous : null,
  };
}

/**
 * 2.8.g: a listing's staff-set points price. Checkout charges max(it, the
 * ledger's quote), so it can raise a price above the backing but never lower
 * one below it. It changes what users pay and how much backing the reserve
 * keeps, so it follows the economy console's two-person shape: finance
 * proposes into `staff.economy_proposal`, a different finance person approves,
 * and only the approval writes `store.listings.min_price_points`, in the same
 * transaction. Brands never reach these routes (Cerbos denies business roles).
 */
@Controller("api/staff/economy")
export class StaffListingPricesController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
    @Inject(LISTING_PRICE_REPOSITORY) private readonly listings: ListingPriceRepository,
    @Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectory,
  ) {}

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "listing-prices",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.view_listing_prices")
  @NotValueMoving("A read; the ledger quotes it asks for are never locked.")
  @Get(":region/listing-prices")
  async screen(
    @Param("region") regionParam: string,
    @Query("q") rawQuery: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<ListingPricesScreen> {
    const region = parseRegion(regionParam);
    const query = rawQuery?.trim().slice(0, 100) || null;
    const facts = await this.listings.search(region, query);
    const pending = await this.proposals.listPending(region, "listing_price");
    const emails = await emailsOf(
      this.directory,
      pending.map((row) => row.proposedBy),
    );
    const ledgerPrices = await this.ledgerPrices(region, facts);
    setStaffAuditContext(request, { targetKind: "region", targetId: region, region });
    return {
      region,
      query,
      rows: facts.map((listing) => {
        const open = pending.find((row) => payloadOf(row).listingId === listing.id);
        const ledgerPrice = ledgerPrices.get(listing.settlementMinor) ?? null;
        return toRow(
          listing,
          ledgerPrice,
          open === undefined
            ? null
            : {
                proposal: toEconomyProposalWithEmail(open, emails.get(open.proposedBy) ?? null),
                minPricePoints: payloadOf(open).minPricePoints,
              },
        );
      }),
    };
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_listing_price",
    idFrom: () => "new",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.propose_listing_price")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/listing-prices/proposals")
  async propose(
    @Param("region") regionParam: string,
    @Body() body: ProposeListingPriceDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const listing = await this.requireListing(body.listingId, region);
    if (listing.minPricePoints === body.minPricePoints) {
      throw new BadRequestException({
        code: "unchanged",
        message: "the listing already has this price",
      });
    }
    const payload: PricePayload = {
      listingId: listing.id,
      minPricePoints: body.minPricePoints,
      previous: listing.minPricePoints,
    };
    const summary =
      body.minPricePoints === null
        ? `Clear the points price of "${listing.title}"`
        : `Price "${listing.title}" at ${String(body.minPricePoints)} points`;
    setStaffAuditContext(request, {
      targetKind: "listing",
      targetId: listing.id,
      region,
      reason: body.reason,
      detail: { minPricePoints: body.minPricePoints, previous: listing.minPricePoints },
    });
    try {
      return toEconomyProposal(
        await this.proposals.create({
          kind: "listing_price",
          region,
          summary,
          payload: { ...payload },
          proposedBy: principal.id,
          reason: body.reason,
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException({
          code: "proposal_pending",
          message: "this listing already has a price proposal waiting for approval",
        });
      }
      throw error;
    }
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve_listing_price",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.approve_listing_price")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/listing-prices/proposals/:id/approve")
  async approve(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requirePending(id, region);
    // `attrsFrom` cannot see the proposer (a DB read): this is the real two-person check.
    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id, attr: { createdBy: row.proposedBy } },
      "approve_listing_price",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const payload = payloadOf(row);
    setStaffAuditContext(request, {
      targetKind: "listing",
      targetId: payload.listingId,
      region,
      detail: { proposalId: id, minPricePoints: payload.minPricePoints },
    });
    const decided = await this.proposals.approveWith(
      row.id,
      principal.id,
      { listingId: payload.listingId, minPricePoints: payload.minPricePoints },
      body.note,
      (client) => this.listings.apply(client, payload.listingId, region, payload.minPricePoints),
    );
    if (decided === null) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: `listing ${payload.listingId} is not in ${region}`,
      });
    }
    return toEconomyProposal(decided);
  }

  /** Declining or withdrawing changes no price, so any finance staff member may, the proposer included. */
  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_listing_price",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.reject_listing_price")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/listing-prices/proposals/:id/reject")
  async reject(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requirePending(id, region);
    setStaffAuditContext(request, {
      targetKind: "listing",
      targetId: payloadOf(row).listingId,
      region,
      detail: { proposalId: id },
    });
    return toEconomyProposal(await this.proposals.reject(row.id, principal.id, body.note));
  }

  /** The ledger's own price for each distinct S, unlocked and never charged. Null where it did not answer. */
  private async ledgerPrices(
    region: Region,
    facts: readonly ListingPriceFacts[],
  ): Promise<Map<number, number>> {
    const prices = new Map<number, number>();
    const currency = region === "AU" ? "AUD" : "IDR";
    for (const settlementMinor of new Set(facts.map((listing) => listing.settlementMinor))) {
      if (settlementMinor <= 0) continue;
      const quoted = await this.ledger.quote({
        region,
        currency,
        settlementMinor: toMinorUnits(settlementMinor),
      });
      if (quoted.isOk()) prices.set(settlementMinor, quoted.value.pricePoints);
    }
    return prices;
  }

  private async requireListing(listingId: string, region: Region): Promise<ListingPriceFacts> {
    const listing = await this.listings.find(listingId);
    if (listing === null || listing.region !== region) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: `no listing ${listingId} in ${region}`,
      });
    }
    return listing;
  }

  private async requirePending(id: string, region: Region): Promise<EconomyProposalRow> {
    const row = await this.proposals.findById(id);
    if (row === null || row.region !== region || row.kind !== "listing_price") {
      throw new NotFoundException({
        code: "proposal_not_found",
        message: `no listing price proposal ${id}`,
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

function toRow(
  listing: ListingPriceFacts,
  ledgerPrice: number | null,
  pending: { readonly proposal: EconomyProposal; readonly minPricePoints: number | null } | null,
): ListingPriceRow {
  return {
    listingId: listing.id,
    title: listing.title,
    merchantName: listing.merchantName,
    faceValueMinor: toMinorUnits(listing.faceValueMinor),
    currency: listing.currency,
    lifecycleState: listing.lifecycleState,
    redeemPartnerId: listing.redeemPartnerId,
    ledgerPricePoints: ledgerPrice === null ? null : toPoints(ledgerPrice),
    minPricePoints: listing.minPricePoints === null ? null : toPoints(listing.minPricePoints),
    effectivePricePoints:
      ledgerPrice === null ? null : toPoints(withStaffPrice(ledgerPrice, listing.minPricePoints)),
    pending:
      pending === null
        ? null
        : {
            proposal: pending.proposal,
            minPricePoints:
              pending.minPricePoints === null ? null : toPoints(pending.minPricePoints),
          },
  };
}
