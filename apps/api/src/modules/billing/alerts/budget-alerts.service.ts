import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { EmailDriver } from "@yourtal/drivers/email";
import type { Region } from "@yourtal/contracts/region";
import { EMAIL_DRIVER } from "../../../shared/drivers/email-driver.module";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { alertEmail, reachedThresholds } from "./alert-copy";
import { BUDGET_ALERTS } from "./budget-alert.repository";
import type {
  BudgetAlertRepository,
  CampaignCandidate,
  NewAlert,
  UnnotifiedAlert,
} from "./budget-alert.repository";

/** Every two minutes: an alert lands within minutes of the grant that crossed it. */
const SWEEP_MS = 2 * 60 * 1000;

export interface SweepResult {
  readonly raised: number;
  readonly notified: number;
}

/**
 * 14.13.b (F121): alerts at 50%, 80% and 100% of a package (an allocation a
 * business bought) and of a campaign's total budget, each once. A sweep reads
 * what the ledger says is left (live session holds count as used, since the
 * ledger will not hold those points again), raises each threshold reached as
 * a `payment.budget_alert` row whose unique key makes it once only, then
 * emails the business's owner and finance members. A sweep that fails to send
 * leaves the row unnotified, and the next sweep sends it; the driver's
 * idempotency key keeps a resend from reaching anyone twice.
 *
 * It runs in the API, like auction settlement, because the ledger client
 * (fake or live) and the email driver both live here.
 */
@Injectable()
export class BudgetAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("BudgetAlerts");
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(LEDGER_INTERNAL_CLIENT)
    private readonly ledger: Pick<LedgerInternalClient, "getAllocation" | "campaignBudgets">,
    @Inject(BUDGET_ALERTS) private readonly alerts: BudgetAlertRepository,
    @Inject(EMAIL_DRIVER) private readonly email: EmailDriver,
  ) {}

  onModuleInit(): void {
    // Tests drive the sweep themselves.
    if (process.env["NODE_ENV"] === "test") return;
    this.timer = setInterval(() => void this.sweepQuietly(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async sweepQuietly(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error(`budget alert sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<SweepResult> {
    const raised = (await this.raisePackageAlerts()) + (await this.raiseCampaignAlerts());
    return { raised, notified: await this.notify() };
  }

  private async raiseAll(subject: Omit<NewAlert, "thresholdPct">): Promise<number> {
    let raised = 0;
    for (const thresholdPct of reachedThresholds(subject.usedPoints, subject.totalPoints)) {
      if (await this.alerts.raise({ ...subject, thresholdPct })) raised += 1;
    }
    return raised;
  }

  private async raisePackageAlerts(): Promise<number> {
    let raised = 0;
    for (const allocationId of await this.alerts.packageCandidates()) {
      const found = await this.allocation(allocationId);
      // A marketing allocation is the platform's, not a package anyone bought.
      if (found === null || found.funderType !== "partner") continue;
      const allocation = found;
      raised += await this.raiseAll({
        businessId: allocation.businessId,
        region: allocation.region,
        kind: "package",
        subjectId: allocation.allocationId,
        usedPoints: allocation.totalPoints - allocation.remainingPoints,
        totalPoints: allocation.totalPoints,
      });
    }
    return raised;
  }

  /** An id no ledger knows (a campaign's config can name one) is skipped, not fatal. */
  private async allocation(allocationId: string) {
    try {
      const found = await this.ledger.getAllocation(allocationId);
      return found.isOk() ? found.value : null;
    } catch {
      return null;
    }
  }

  private async raiseCampaignAlerts(): Promise<number> {
    const byRegion = new Map<Region, CampaignCandidate[]>();
    for (const candidate of await this.alerts.campaignCandidates()) {
      byRegion.set(candidate.region, [...(byRegion.get(candidate.region) ?? []), candidate]);
    }
    let raised = 0;
    for (const [region, candidates] of byRegion) {
      const budgets = await this.ledger.campaignBudgets({
        region,
        campaignIds: candidates.map((candidate) => candidate.campaignId),
      });
      if (budgets.isErr()) {
        this.logger.warn(`campaign budgets for ${region}: ${budgets.error.message}`);
        continue;
      }
      const remaining = new Map(budgets.value.map((b) => [b.campaignId, b.remainingPoints]));
      for (const candidate of candidates) {
        const left = remaining.get(candidate.campaignId);
        if (left === undefined) continue;
        raised += await this.raiseAll({
          businessId: candidate.businessId,
          region,
          kind: "campaign",
          subjectId: candidate.campaignId,
          usedPoints: Math.max(0, candidate.budgetPoints - left),
          totalPoints: candidate.budgetPoints,
        });
      }
    }
    return raised;
  }

  /** One email per subject per sweep, for its highest new threshold; the lower ones it covers are told too. */
  private async notify(): Promise<number> {
    const bySubject = new Map<string, UnnotifiedAlert[]>();
    for (const alert of await this.alerts.unnotified()) {
      const key = `${alert.kind}:${alert.subjectId}`;
      bySubject.set(key, [...(bySubject.get(key) ?? []), alert]);
    }
    let notified = 0;
    for (const group of bySubject.values()) {
      const highest = group.reduce((top, alert) =>
        alert.thresholdPct > top.thresholdPct ? alert : top,
      );
      if (await this.send(highest)) {
        await this.alerts.markNotified(group.map((alert) => alert.id));
        notified += group.length;
      }
    }
    return notified;
  }

  private async send(alert: UnnotifiedAlert): Promise<boolean> {
    let delivered = true;
    for (const recipient of await this.alerts.recipients(alert.businessId)) {
      const { subject, body } = alertEmail(recipient.locale, alert);
      const sent = await this.email.send({
        idempotencyKey: `budget-alert:${alert.id}:${recipient.userId}`,
        to: recipient.email,
        region: alert.region,
        category: "budget_alert",
        subject,
        body,
        metadata: { alertId: alert.id, kind: alert.kind, thresholdPct: alert.thresholdPct },
      });
      if (sent.isErr()) {
        this.logger.warn(`budget alert ${alert.id} to ${recipient.userId}: ${sent.error.detail}`);
        delivered = false;
      }
    }
    return delivered;
  }
}
