"use client";

import { useId, useState } from "react";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { Input } from "@yourtal/ui/input";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TransferCandidate {
  userId: string;
  name: string;
}

export interface TeamTransferDialogProps {
  open: boolean;
  /** Every joined non-Owner member — `transferOwnership` refuses a successor who has not joined yet. */
  candidates: readonly TransferCandidate[];
  onOpenChange: (open: boolean) => void;
  /** Mock re-authentication: any non-empty password "succeeds" — there is no real auth backend in Phase U. Returns the re-auth timestamp (ms) on success. */
  onReauthenticate: (password: string) => number | null;
  onTransfer: (successorUserId: string, reauthenticatedAtMs: number) => TeamActionError | null;
}

type Step = "reauth" | "select";

/**
 * Two steps in one dialog, matching `policies/resource_policies/team.yaml`'s
 * `ownership-transfer-needs-fresh-reauth` rule: a step-up re-authentication
 * (mocked here — there is no real auth backend yet) immediately followed by
 * picking the successor, so the 5-minute freshness window
 * (`team-actions.ts`'s `isReauthFresh`) is never at risk of lapsing between
 * the two steps in normal use. Re-opening this dialog always restarts at
 * "reauth" — a stale re-authentication from a previous open is never reused
 * silently.
 */
export function TeamTransferDialog({
  open,
  candidates,
  onOpenChange,
  onReauthenticate,
  onTransfer,
}: TeamTransferDialogProps) {
  const [step, setStep] = useState<Step>("reauth");
  const [password, setPassword] = useState("");
  const [reauthenticatedAtMs, setReauthenticatedAtMs] = useState<number | null>(null);
  const [successorUserId, setSuccessorUserId] = useState<string>(candidates[0]?.userId ?? "");
  const [error, setError] = useState<string | null>(null);
  const successorSelectId = useId();

  function reset() {
    setStep("reauth");
    setPassword("");
    setReauthenticatedAtMs(null);
    setError(null);
  }

  function submitReauth() {
    const timestamp = onReauthenticate(password);
    if (timestamp === null) {
      setError("Incorrect password.");
      return;
    }
    setReauthenticatedAtMs(timestamp);
    setError(null);
    setStep("select");
  }

  function handleTransferConfirm() {
    if (reauthenticatedAtMs === null || !successorUserId) {
      return;
    }
    const failure = onTransfer(successorUserId, reauthenticatedAtMs);
    if (failure) {
      setError(teamActionErrorMessage(failure));
      // A stale re-auth surfaces here, not before — push the person back to step one honestly.
      if (failure.type === "reauth_expired" || failure.type === "reauth_required") {
        setStep("reauth");
      }
      return;
    }
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            {step === "reauth"
              ? "Confirm your password to continue — ownership transfer needs a fresh re-authentication."
              : "Pick who becomes Owner. You will become Admin immediately after."}
          </DialogDescription>
        </DialogHeader>
        {step === "reauth" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitReauth();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              {...(error ? { errorMessage: error } : {})}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={successorSelectId} className="text-sm font-sans font-medium text-fg">
                New Owner
              </label>
              <select
                id={successorSelectId}
                value={successorUserId}
                onChange={(event) => setSuccessorUserId(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {error ? (
                <p role="alert" className="text-xs font-sans text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleTransferConfirm}
                disabled={!successorUserId}
              >
                Transfer ownership
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
