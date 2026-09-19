"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
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

interface TransferFormValues {
  password: string;
  successorUserId: string;
}

/**
 * Two steps in one dialog, matching `policies/resource_policies/team.yaml`'s
 * `ownership-transfer-needs-fresh-reauth` rule: a step-up re-authentication
 * (mocked here — there is no real auth backend yet) immediately followed by
 * picking the successor, so the 5-minute freshness window
 * (`team-actions.ts`'s `isReauthFresh`) is never at risk of lapsing between
 * the two steps in normal use. Re-opening this dialog always restarts at
 * "reauth" — a stale re-authentication from a previous open is never reused
 * silently.
 *
 * Migrated to React Hook Form (YT-0525): `password` and `successorUserId`
 * are the two real named fields, one per step, both driven by one `useForm`
 * instance so `successorUserId` — like the pre-migration `useState` it
 * replaces — deliberately survives `reset()` across a reauth failure; only
 * `password` and the transient reauth/step state reset. No Zod schema is
 * added for a two-field, two-step dialog with no cross-field rule.
 */
export function TeamTransferDialog({
  open,
  candidates,
  onOpenChange,
  onReauthenticate,
  onTransfer,
}: TeamTransferDialogProps) {
  const [step, setStep] = useState<Step>("reauth");
  const [reauthenticatedAtMs, setReauthenticatedAtMs] = useState<number | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const successorSelectId = useId();
  const {
    register,
    handleSubmit,
    resetField,
    watch,
    setError,
    formState: { errors },
  } = useForm<TransferFormValues>({
    defaultValues: { password: "", successorUserId: candidates[0]?.userId ?? "" },
  });
  const successorUserId = watch("successorUserId");

  function reset() {
    setStep("reauth");
    resetField("password");
    setReauthenticatedAtMs(null);
    setTransferError(null);
  }

  function submitReauth(values: TransferFormValues) {
    const timestamp = onReauthenticate(values.password);
    if (timestamp === null) {
      setError("password", { type: "server", message: "Incorrect password." });
      return;
    }
    setReauthenticatedAtMs(timestamp);
    setStep("select");
  }

  function handleTransferConfirm() {
    if (reauthenticatedAtMs === null || !successorUserId) {
      return;
    }
    const failure = onTransfer(successorUserId, reauthenticatedAtMs);
    if (failure) {
      setTransferError(teamActionErrorMessage(failure));
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
            onSubmit={(event) => void handleSubmit(submitReauth)(event)}
            className="flex flex-col gap-4"
          >
            <Input
              label="Password"
              type="password"
              required
              {...register("password", { required: true })}
              {...(errors.password?.message ? { errorMessage: errors.password.message } : {})}
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
                {...register("successorUserId")}
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {transferError ? (
                <p role="alert" className="text-xs font-sans text-danger">
                  {transferError}
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
