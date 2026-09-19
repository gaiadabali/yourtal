"use client";

import { useState } from "react";
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
            {isSelf ? "Remove yourself from this team?" : `Remove ${targetName}?`}
          </DialogTitle>
          <DialogDescription>
            {isSelf
              ? "You will lose access to this business console immediately. Another Owner or Admin will need to invite you back."
              : `${targetName} will immediately lose all access to this business console. This can't be undone from here — they'd need a new invite.`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            {isSelf ? "Remove me" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
