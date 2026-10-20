import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { CheckDisbursementOutcome } from "@yourtal/contracts/staff/settlement";
import type { Region } from "@yourtal/contracts/region";
import type { PayoutDetails } from "@yourtal/drivers/payout-accounts";
import { PAYMENT_PROVIDERS } from "../../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../../shared/drivers/payment-providers.module";
import { DISBURSEMENT_RECOVERY } from "../../payouts/disbursement-recovery.repository";
import type {
  DisbursementRecord,
  DisbursementRecoveryRepository,
} from "../../payouts/disbursement-recovery.repository";
import { ECONOMY_PROPOSAL_REPOSITORY } from "../economy/persistence/economy-proposal.repository";
import type {
  EconomyProposalRepository,
  EconomyProposalRow,
} from "../economy/persistence/economy-proposal.repository";
import { needsStaff } from "./to-staff-disbursement";

/** Objects are looked for from a little before the row existed, for clock differences. */
const LOOK_BACK_MS = 10 * 60_000;

/** What the processor shows of a disbursement's money. */
type Seen =
  | { readonly kind: "transfer"; readonly transferRef: string }
  | { readonly kind: "payout"; readonly payout: PayoutDetails }
  | { readonly kind: "nothing" };

interface RetryPayload {
  readonly disbursementId: string;
  readonly attempt: number;
  readonly failureCode: string;
}

const payloadOf = (row: EconomyProposalRow): RetryPayload => row.payload as unknown as RetryPayload;

/**
 * 5.2.c: a payout is never in flight unseen. For a disbursement the job will not
 * move by itself (an unconfirmed or refused transfer or payout), staff can
 * "check again" (read the processor and record what it shows) and, only once the
 * processor shows nothing moved, retry it. A retry is two-person and is a new
 * payout attempt (a new key, `payout:<statement>:<attempt + 1>`); a row without a
 * transfer is queued again under the transfer key it always had, so a statement
 * is transferred once and never a second time. The processor is asked again at
 * approval, whatever it said at proposal.
 */
@Injectable()
export class DisbursementRecoveryService {
  constructor(
    @Inject(DISBURSEMENT_RECOVERY) private readonly rows: DisbursementRecoveryRepository,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: RegionPaymentProviders,
  ) {}

  /** Reads the processor and settles the row on what it shows. Moves no money. */
  async check(region: Region, id: string): Promise<CheckDisbursementOutcome> {
    const row = this.requireStuck(await this.load(region, id));
    const seen = await this.look(row);
    if (seen.kind === "nothing") {
      await this.rows.touchChecked(row.id);
      return "nothing_found";
    }
    const done =
      seen.kind === "transfer"
        ? await this.rows.adoptTransfer(row, seen.transferRef)
        : await this.rows.adoptPayout(row, seen.payout);
    if (!done) throw this.rowChanged();
    if (seen.kind === "transfer") return "transferred";
    return seen.payout.status;
  }

  /** Records the proposal after the processor, asked now, shows nothing moved. */
  async proposeRetry(
    region: Region,
    id: string,
    proposedBy: string,
    reason: string,
  ): Promise<EconomyProposalRow> {
    const row = this.requireStuck(await this.load(region, id));
    const open = (await this.proposals.listPending(region, "retry_disbursement")).some(
      (pending) => payloadOf(pending).disbursementId === id,
    );
    if (open) throw this.alreadyProposed();
    this.requireNothingMoved(await this.look(row));
    try {
      return await this.proposals.create({
        kind: "retry_disbursement",
        region,
        summary: `Retry payout for statement ${row.statementId} (attempt ${String(row.attempt)}, ${String(row.failureCode)})`,
        payload: {
          disbursementId: id,
          statementId: row.statementId,
          attempt: row.attempt,
          failureCode: row.failureCode,
          amountMinor: row.amountMinor,
        },
        proposedBy,
        reason,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw this.alreadyProposed();
      throw error;
    }
  }

  /** A pending retry proposal of this region, or 404 / 400. */
  async requirePending(region: Region, id: string): Promise<EconomyProposalRow> {
    const row = await this.proposals.findById(id);
    if (row === null || row.region !== region || row.kind !== "retry_disbursement") {
      throw new NotFoundException({
        code: "proposal_not_found",
        message: `no payout retry proposal ${id}`,
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

  /**
   * The second person's approval. The row must still be as proposed and the
   * processor, asked again, must show nothing moved; then the row is queued for
   * the job and the proposal approved in one transaction, so it happens once.
   */
  async approveRetry(
    region: Region,
    proposal: EconomyProposalRow,
    approvedBy: string,
    note?: string,
  ): Promise<EconomyProposalRow> {
    const { disbursementId, attempt, failureCode } = payloadOf(proposal);
    const row = await this.load(region, disbursementId);
    if (row.status !== "failed" || row.attempt !== attempt || row.failureCode !== failureCode) {
      throw this.rowChanged();
    }
    this.requireNothingMoved(await this.look(row));
    const decided = await this.proposals.approveWith(
      proposal.id,
      approvedBy,
      { disbursementId, statementId: row.statementId, attempt, nextAttempt: attempt + 1 },
      note,
      async (client) => {
        // No transfer yet: the same transfer key is tried again. A transfer exists: a new payout attempt.
        const { rowCount } = await client.query(
          row.transferRef === null
            ? `UPDATE payment.disbursement
                  SET status = 'queued', failure_code = NULL, failed_at = NULL,
                      transfer_requested_at = NULL, payout_checked_at = NULL, updated_at = now()
                WHERE id = $1 AND status = 'failed' AND attempt = $2 AND failure_code = $3
                  AND transfer_ref IS NULL`
            : `UPDATE payment.disbursement
                  SET status = 'transferred', attempt = attempt + 1, payout_ref = NULL,
                      payout_requested_at = NULL, failure_code = NULL, failed_at = NULL,
                      payout_checked_at = NULL, updated_at = now()
                WHERE id = $1 AND status = 'failed' AND attempt = $2 AND failure_code = $3
                  AND transfer_ref IS NOT NULL`,
          [disbursementId, attempt, failureCode],
        );
        return (rowCount ?? 0) > 0;
      },
    );
    if (decided === null) throw this.rowChanged();
    return decided;
  }

  async reject(
    region: Region,
    proposal: EconomyProposalRow,
    decidedBy: string,
    note?: string,
  ): Promise<EconomyProposalRow> {
    await this.load(region, payloadOf(proposal).disbursementId);
    return this.proposals.reject(proposal.id, decidedBy, note);
  }

  private async load(region: Region, id: string): Promise<DisbursementRecord> {
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await this.rows.find(id) : null;
    if (row === null || row.region !== region) {
      throw new NotFoundException({ code: "disbursement_not_found", message: `no payout ${id}` });
    }
    return row;
  }

  private requireStuck(row: DisbursementRecord): DisbursementRecord {
    if (!needsStaff(row.status, row.failureCode)) {
      throw new ConflictException({
        code: "not_stuck",
        message: "the payout is moving on its own, or is already settled",
      });
    }
    return row;
  }

  private requireNothingMoved(seen: Seen): void {
    if (seen.kind !== "nothing") {
      throw new ConflictException({
        code: "processor_shows_money",
        message: "the processor shows this money was sent; check again to record it",
      });
    }
  }

  /**
   * Asks the processor what became of this disbursement's money: its payout by
   * id or by the reference sent, or its transfer by the reference sent. A scan
   * that could not finish is an error, never "nothing" (money may have moved).
   */
  private async look(row: DisbursementRecord): Promise<Seen> {
    const driver = this.providers.AU.payoutAccounts;
    if (row.accountRef === null) {
      throw new ConflictException({ code: "no_account", message: "the payout has no account" });
    }
    const since = new Date(row.createdAt.getTime() - LOOK_BACK_MS);
    const unavailable = (detail: string) =>
      new ServiceUnavailableException({ code: "processor_unavailable", message: detail });
    const sameAmount = (amountMinor: number, currency: string) => {
      if (amountMinor !== row.amountMinor || currency !== "AUD") {
        throw new ConflictException({
          code: "amount_mismatch",
          message: "the processor shows a different amount for this payout",
        });
      }
    };

    if (row.payoutRef !== null || row.transferRef !== null) {
      const read =
        row.payoutRef !== null
          ? await driver.getPayout(row.accountRef, row.payoutRef)
          : await driver.findPayout({
              accountRef: row.accountRef,
              reference: `disbursement:${row.id}:${String(row.attempt)}`,
              since,
            });
      if (read.isErr()) throw unavailable(read.error.detail);
      if (read.value === null) return { kind: "nothing" };
      sameAmount(read.value.amountMinor, read.value.currency);
      return { kind: "payout", payout: read.value };
    }
    const found = await driver.findTransfer({
      accountRef: row.accountRef,
      reference: `disbursement:${row.id}`,
      since,
    });
    if (found.isErr()) throw unavailable(found.error.detail);
    if (found.value === null) return { kind: "nothing" };
    sameAmount(found.value.amountMinor, found.value.currency);
    return { kind: "transfer", transferRef: found.value.transferRef };
  }

  private rowChanged(): ConflictException {
    return new ConflictException({
      code: "row_changed",
      message: "the payout changed since it was proposed; look at it again",
    });
  }

  private alreadyProposed(): ConflictException {
    return new ConflictException({
      code: "retry_already_proposed",
      message: "a retry for this payout is already waiting for a second staff member",
    });
  }
}
