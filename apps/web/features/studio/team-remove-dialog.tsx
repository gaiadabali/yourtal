"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TeamRemoveDialogProps {
  open: boolean;
  targetName: string;
  /**
   * Whether the person removing this row IS this row — the policy does not
   * special-case self-removal (`removeMember` allows it, see
   * `team-actions.test.ts`), so the UI's job is to make sure they cannot do
   * it by accident, not to block an outcome the policy permits.
   */
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => TeamActionError | null;
}

export function TeamRemoveDialog({
  open,
  targetName,
  isSelf,
  onOpenChange,
  onConfirm,
}: TeamRemoveDialogProps) {
  const t = useTranslations("studio");
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    const failure = onConfirm();
    if (failure) {
      setError(teamActionErrorMessage(failure));
      return;
    }
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSelf
              ? t("team.remove.titleSelf")
              : t("team.remove.title", { name: targetName })}
          </DialogTitle>
          <DialogDescription>
            {isSelf
              ? t("team.remove.descriptionSelf")
              : t("team.remove.description", { name: targetName })}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("team.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            {isSelf ? t("team.remove.confirmSelf") : t("team.remove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
