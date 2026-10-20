"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import type { CheckDisbursementOutcome } from "@yourtal/contracts/staff/settlement";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import {
  checkDisbursementAction,
  decideRetryAction,
  proposeRetryAction,
  type DisbursementActionResult,
} from "./staff-settlement-actions";

export interface StaffDisbursementActionsProps {
  readonly region: "AU" | "ID";
  readonly disbursement: StaffDisbursement;
  /** Short name of the payout (its statement), put in every button's accessible name. */
  readonly payoutLabel: string;
  readonly currentStaffId: string;
}

type Flash = { tone: "success" | "info" | "warning" | "danger"; text: string } | null;

/** After a check that found the payout alive, a retry would be wrong: only "failed" and "nothing found" leave it open. */
const RETRY_BLOCKED: readonly CheckDisbursementOutcome[] = ["paid", "pending", "transferred"];

/** 5.2.c: check a stuck payout again, and propose (or decide) a retry. Only rendered for rows that need staff. */
export function StaffDisbursementActions({
  region,
  disbursement,
  payoutLabel,
  currentStaffId,
}: StaffDisbursementActionsProps) {
  const t = useTranslations("staff");
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>(null);
  const [outcome, setOutcome] = useState<CheckDisbursementOutcome | null>(null);
  const [isPending, startTransition] = useTransition();

  function fail(result: Extract<DisbursementActionResult, { ok: false }>): false {
    setFlash({
      tone: "danger",
      text: result.message === "" ? t("errors.actionFailed") : result.message,
    });
    return false;
  }

  function check() {
    startTransition(() => {
      void checkDisbursementAction(region, disbursement.id).then((result) => {
        if (!result.ok) {
          fail(result);
          return;
        }
        const found = result.outcome ?? "nothing_found";
        setOutcome(found);
        setFlash({
          tone: found === "paid" ? "success" : found === "failed" ? "warning" : "info",
          text: t(`settlement.check.${found}`),
        });
        router.refresh();
      });
    });
  }

  function decide(proposalId: string, decision: "approve" | "reject") {
    startTransition(() => {
      void decideRetryAction(region, proposalId, decision).then((result) => {
        if (!result.ok) {
          fail(result);
          return;
        }
        setFlash({
          tone: "success",
          text:
            decision === "approve"
              ? t("settlement.retry.approved")
              : t("settlement.retry.rejected"),
        });
        router.refresh();
      });
    });
  }

  async function propose(reason: string): Promise<boolean> {
    const result = await proposeRetryAction(region, disbursement.id, reason);
    if (!result.ok) return fail(result);
    setFlash({ tone: "success", text: t("settlement.retry.proposed") });
    router.refresh();
    return true;
  }

  const proposal = disbursement.retryProposal;
  const canPropose = proposal === null && (outcome === null || !RETRY_BLOCKED.includes(outcome));

  return (
    <div className="flex flex-col items-start gap-2">
      {disbursement.checkedAt === null ? null : (
        <Text size="body-sm" tone="muted">
          {t("settlement.lastChecked", {
            date: new Date(disbursement.checkedAt).toLocaleString(),
          })}
        </Text>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={isPending}
          aria-label={t("settlement.checkCtaFor", { payout: payoutLabel })}
          onClick={check}
        >
          {t("settlement.checkCta")}
        </Button>
        {canPropose ? (
          <StaffReasonDialogButton
            triggerLabel={t("settlement.retry.proposeCta")}
            triggerAriaLabel={t("settlement.retry.proposeCtaFor", { payout: payoutLabel })}
            dialogTitle={t("settlement.retry.dialogTitle", { payout: payoutLabel })}
            dialogBody={t("settlement.retry.dialogBody")}
            submitLabel={t("settlement.retry.proposeSubmit")}
            onSubmit={propose}
          />
        ) : null}
      </div>
      {proposal === null ? null : (
        <>
          <Text size="body-sm" tone="muted">
            {t("settlement.retry.proposedBy", { staff: proposal.proposedBy })}
          </Text>
          {proposal.proposedBy === currentStaffId ? (
            <Text size="body-sm" tone="muted">
              {t("settlement.retry.awaitingSecondStaff")}
            </Text>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isPending}
                aria-label={t("settlement.retry.approveCtaFor", { payout: payoutLabel })}
                onClick={() => decide(proposal.id, "approve")}
              >
                {t("settlement.retry.approveCta")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending}
                aria-label={t("settlement.retry.rejectCtaFor", { payout: payoutLabel })}
                onClick={() => decide(proposal.id, "reject")}
              >
                {t("settlement.retry.rejectCta")}
              </Button>
            </div>
          )}
        </>
      )}
      {flash === null ? null : <Notice tone={flash.tone}>{flash.text}</Notice>}
    </div>
  );
}
