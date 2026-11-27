"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { Notice } from "@yourtal/ui/notice";
import { Textarea } from "@yourtal/ui/textarea";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { changeAutoreplyAction } from "./spambank-staff-actions";
import type { SpambankAutoreplyChange } from "./spambank-staff-contract";

export interface SpambankAutoreplyControlsProps {
  readonly tripped: boolean;
  readonly paused: boolean;
  readonly dailyCap: number;
}

/**
 * BUILD.md 4.6/5.4: the staff-side kill switch (instant, layer 2), the resume
 * after an auto-pause, and the daily cap. Each change carries a reason the API
 * records. These buttons are a courtesy for `ops`/`admin`; the API enforces.
 */
export function SpambankAutoreplyControls({
  tripped,
  paused,
  dailyCap,
}: SpambankAutoreplyControlsProps) {
  const t = useTranslations("staff.spambank.autoreply");
  const tc = useTranslations("staff");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function apply(change: SpambankAutoreplyChange): Promise<boolean> {
    const result = await changeAutoreplyAction(change);
    if (result.ok) {
      setError(null);
      router.refresh();
      return true;
    }
    setError(tc("errors.actionFailed"));
    return false;
  }

  return (
    <div className="flex flex-col gap-4">
      {error === null ? null : <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        {tripped ? (
          <StaffReasonDialogButton
            triggerLabel={t("untripCta")}
            dialogTitle={t("untripTitle")}
            dialogBody={t("untripBody")}
            submitLabel={t("untripSubmit")}
            onSubmit={(reason) => apply({ tripped: false, reason })}
          />
        ) : (
          <StaffReasonDialogButton
            triggerLabel={t("tripCta")}
            triggerVariant="danger"
            dialogTitle={t("tripTitle")}
            dialogBody={t("tripBody")}
            submitLabel={t("tripSubmit")}
            onSubmit={(reason) => apply({ tripped: true, reason })}
          />
        )}
        {paused ? (
          <StaffReasonDialogButton
            triggerLabel={t("resumeCta")}
            dialogTitle={t("resumeTitle")}
            dialogBody={t("resumeBody")}
            submitLabel={t("resumeSubmit")}
            onSubmit={(reason) => apply({ resume: true, reason })}
          />
        ) : null}
      </div>
      <DailyCapForm key={dailyCap} dailyCap={dailyCap} apply={apply} />
    </div>
  );
}

function DailyCapForm({
  dailyCap,
  apply,
}: {
  readonly dailyCap: number;
  readonly apply: (change: SpambankAutoreplyChange) => Promise<boolean>;
}) {
  const t = useTranslations("staff.spambank.autoreply");
  const [cap, setCap] = useState(String(dailyCap));
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const reasonId = useId();
  const value = Number(cap);
  const valid = Number.isInteger(value) && value >= 1 && value <= 100000 && reason.trim() !== "";

  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        startTransition(() => {
          void apply({ dailyCap: value, reason: reason.trim() }).then((ok) => {
            if (ok) setReason("");
          });
        });
      }}
    >
      <Input
        label={t("capLabel")}
        helpText={t("capHelp")}
        type="number"
        inputMode="numeric"
        min={1}
        max={100000}
        value={cap}
        onChange={(event) => setCap(event.target.value)}
        className="w-40"
      />
      <Textarea
        id={reasonId}
        label={t("capReasonLabel")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div>
        <Button type="submit" variant="secondary" loading={pending} disabled={!valid}>
          {t("capSubmit")}
        </Button>
      </div>
    </form>
  );
}
