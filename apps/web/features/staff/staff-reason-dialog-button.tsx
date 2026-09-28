"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Heading } from "@yourtal/ui/heading";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";

export interface StaffReasonDialogButtonProps {
  readonly triggerLabel: string;
  readonly triggerVariant?: "primary" | "secondary" | "danger" | "ghost";
  readonly dialogTitle: string;
  readonly dialogBody: string;
  readonly submitLabel: string;
  /** Resolves once the action settles. `false` leaves the dialog open so the reason is not lost. */
  readonly onSubmit: (reason: string) => Promise<boolean>;
}

/**
 * TASKS.md 9.3.a/9.2.c: every staff review action (KYB approve/reject,
 * suspend/reinstate, voucher-batch approve/reject) carries a required
 * `reason`, entered here and never submittable empty -- shared so every one
 * of those six buttons is the same component, not six near-identical forms.
 */
export function StaffReasonDialogButton({
  triggerLabel,
  triggerVariant = "secondary",
  dialogTitle,
  dialogBody,
  submitLabel,
  onSubmit,
}: StaffReasonDialogButtonProps) {
  const t = useTranslations("staff");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const reasonInputId = useId();
  const trimmed = reason.trim();

  function submit() {
    if (trimmed === "") return;
    startTransition(() => {
      void onSubmit(trimmed).then((ok) => {
        if (ok) {
          setOpen(false);
          setReason("");
        }
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("dialog.close")}>
        <DialogHeader>
          <Heading level={2} size="title">
            {dialogTitle}
          </Heading>
          <Text tone="muted">{dialogBody}</Text>
        </DialogHeader>
        <Textarea
          id={reasonInputId}
          label={t("dialog.reasonLabel")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            {t("dialog.cancel")}
          </Button>
          <Button onClick={submit} loading={isPending} disabled={trimmed === ""}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
