import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { ParkedPurchase, ParkedPurchases } from "@yourtal/contracts/staff/parked-purchases";
import { PAYMENT_PROVIDERS } from "../../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../../shared/drivers/payment-providers.module";
import { CARD_PURCHASE_REFUNDS } from "../../billing/persistence/card-purchase-refund.repository";
import type {
  CardPurchaseRefundRepository,
  ParkedPurchaseRow,
} from "../../billing/persistence/card-purchase-refund.repository";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposal,
} from "./persistence/economy-proposal.repository";
import type {
  EconomyProposalRepository,
  EconomyProposalRow,
} from "./persistence/economy-proposal.repository";

/** The same key for a purchase whoever approves, so the processor refunds it once. */
export const refundKey = (purchaseId: string) => `card-purchase-refund:${purchaseId}`;

interface RefundPayload {
  readonly purchaseId: string;
}

const purchaseIdOf = (row: EconomyProposalRow): string =>
  (row.payload as unknown as RefundPayload).purchaseId;

/**
 * 5.1.g (F123): a paid card purchase the ledger would not turn into points is
 * settled by refunding the card in full, with two-person approval. Money moves
 * exactly once: the approval claims the purchase for its proposal, then asks the
 * processor under a key derived from the purchase (a refund of what is left, so
 * a second one would be refused too), and only then marks it refunded. A crash
 * between the steps is finished by approving again; the webhook does the same.
 */
@Injectable()
export class ParkedPurchasesService {
  constructor(
    @Inject(CARD_PURCHASE_REFUNDS) private readonly refunds: CardPurchaseRefundRepository,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: RegionPaymentProviders,
  ) {}

  async list(region: Region): Promise<ParkedPurchases> {
    const [rows, pending] = await Promise.all([
      this.refunds.listParked(region),
      this.proposals.listPending(region, "refund_purchase"),
    ]);
    const byPurchase = new Map(pending.map((row) => [purchaseIdOf(row), row]));
    return {
      region,
      purchases: rows.map((row) => {
        const proposal = byPurchase.get(row.id);
        return this.toParked(
          region,
          row,
          proposal === undefined ? null : toEconomyProposal(proposal),
        );
      }),
    };
  }

  /** Records the proposal only: nothing is claimed and no processor is called. */
  async propose(
    region: Region,
    purchaseId: string,
    proposedBy: string,
    reason: string,
  ): Promise<EconomyProposalRow> {
    const purchase = await this.requireParked(region, purchaseId);
    if (purchase.status !== "needs_review") {
      throw new ConflictException({ code: "not_parked", message: "already refunded" });
    }
    this.requireRefundable(region, purchase);
    const open = (await this.proposals.listPending(region, "refund_purchase")).some(
      (row) => purchaseIdOf(row) === purchaseId,
    );
    if (open) throw this.alreadyProposed();
    try {
      return await this.proposals.create({
        kind: "refund_purchase",
        region,
        summary: `Refund card purchase of ${String(purchase.points)} pts for business ${purchase.businessId} (${String(purchase.totalMinor)} ${purchase.currency} minor units)`,
        payload: {
          purchaseId,
          businessId: purchase.businessId,
          totalMinor: purchase.totalMinor,
          currency: purchase.currency,
        },
        proposedBy,
        reason,
      });
    } catch (error) {
      // The unique index on one pending refund per purchase: a concurrent proposal won.
      if ((error as { code?: string }).code === "23505") throw this.alreadyProposed();
      throw error;
    }
  }

  /** A pending refund proposal of this region, or 404 / 400. */
  async requirePending(region: Region, id: string): Promise<EconomyProposalRow> {
    const row = await this.proposals.findById(id);
    if (row === null || row.region !== region || row.kind !== "refund_purchase") {
      throw new NotFoundException({
        code: "proposal_not_found",
        message: `no refund proposal ${id}`,
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

  /** The second person's approval: refunds the card, once. The caller has checked two-person authorization. */
  async approve(
    region: Region,
    row: EconomyProposalRow,
    approvedBy: string,
    note?: string,
  ): Promise<EconomyProposalRow> {
    const purchase = await this.requireParked(region, purchaseIdOf(row));
    if (purchase.status === "refunded") {
      // Refunded under this proposal but not yet closed: finish it, never refund again.
      if (purchase.refundProposalId !== row.id) {
        throw new ConflictException({ code: "already_refunded", message: "already refunded" });
      }
      return this.close(row, approvedBy, purchase, purchase.refundRef ?? "", note);
    }
    const driver = this.requireRefundable(region, purchase);
    const claimed = await this.refunds.claim(purchase.id, row.id, approvedBy);
    if (!claimed) {
      throw new ConflictException({
        code: "refund_not_available",
        message: "the purchase is no longer parked, or another refund owns it",
      });
    }
    const sent = await driver.refund({
      idempotencyKey: refundKey(purchase.id),
      paymentReference: purchase.paymentRef ?? "",
      currency: purchase.currency,
      reference: `card-purchase:${purchase.id}`,
    });
    if (sent.isErr()) {
      if (!sent.error.mayHaveSucceeded) {
        // Nothing was refunded: free the purchase, so a fresh proposal may follow.
        await this.refunds.release(purchase.id, row.id);
        throw new ConflictException({ code: "refund_refused", message: sent.error.detail });
      }
      throw new ServiceUnavailableException({
        code: "refund_unconfirmed",
        message: "the processor did not confirm the refund; approve again to finish it",
      });
    }
    await this.refunds.finish(purchase.id, row.id, sent.value.refundReference);
    return this.close(row, approvedBy, purchase, sent.value.refundReference, note);
  }

  /** Withdraws or declines a proposal. Refused while a refund may be in flight. */
  async reject(
    region: Region,
    row: EconomyProposalRow,
    decidedBy: string,
    note?: string,
  ): Promise<EconomyProposalRow> {
    const purchase = await this.refunds.findParked(purchaseIdOf(row));
    if (purchase?.refundProposalId === row.id) {
      throw new ConflictException({
        code: "refund_in_flight",
        message: "a refund may already be on its way; approve again to confirm it",
      });
    }
    if (purchase !== null && purchase.region !== region) {
      throw new NotFoundException({ code: "purchase_not_found", message: "no such purchase" });
    }
    return this.proposals.reject(row.id, decidedBy, note);
  }

  private close(
    row: EconomyProposalRow,
    approvedBy: string,
    purchase: ParkedPurchaseRow,
    refundRef: string,
    note?: string,
  ): Promise<EconomyProposalRow> {
    return this.proposals.approve(
      row.id,
      approvedBy,
      {
        purchaseId: purchase.id,
        refundRef,
        totalMinor: purchase.totalMinor,
        currency: purchase.currency,
      },
      note,
    );
  }

  private async requireParked(region: Region, purchaseId: string): Promise<ParkedPurchaseRow> {
    const purchase = await this.refunds.findParked(purchaseId);
    if (purchase === null || purchase.region !== region) {
      throw new NotFoundException({
        code: "purchase_not_found",
        message: "no such parked purchase",
      });
    }
    return purchase;
  }

  /** The driver that took this purchase's payment, or a refusal when there is nothing to refund through. */
  private requireRefundable(region: Region, purchase: ParkedPurchaseRow) {
    const driver = this.providers[region].payments;
    if (purchase.paymentRef === null) {
      throw new ConflictException({
        code: "not_refundable",
        message: "the purchase has no payment reference; check the payment at the processor",
      });
    }
    if (driver.provider !== purchase.provider) {
      throw new ConflictException({
        code: "not_refundable",
        message: `paid through ${purchase.provider}, but this region now runs ${driver.provider}`,
      });
    }
    return driver;
  }

  private alreadyProposed(): ConflictException {
    return new ConflictException({
      code: "refund_already_proposed",
      message: "a refund for this purchase is already waiting for a second staff member",
    });
  }

  private toParked(
    region: Region,
    row: ParkedPurchaseRow,
    proposal: ParkedPurchase["proposal"],
  ): ParkedPurchase {
    const refundable =
      row.status === "needs_review" &&
      row.paymentRef !== null &&
      this.providers[region].payments.provider === row.provider;
    return {
      purchaseId: row.id,
      businessId: row.businessId,
      businessName: row.businessName,
      region: row.region,
      currency: row.currency,
      tierKey: row.tierKey,
      points: toPoints(row.points),
      subtotalMinor: toMinorUnits(row.subtotalMinor),
      taxMinor: toMinorUnits(row.taxMinor),
      totalMinor: toMinorUnits(row.totalMinor),
      status: row.status,
      reason: row.reviewReason,
      paidAt: row.paidAt === null ? null : row.paidAt.toISOString(),
      refundedAt: row.refundedAt === null ? null : row.refundedAt.toISOString(),
      refundedBy: row.refundRequestedBy,
      proposal,
      refundable,
    };
  }
}
