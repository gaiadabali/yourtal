"use client";

import { useId, useState } from "react";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
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
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "./console-roles";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TeamInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, role: Exclude<BusinessTeamRole, "owner">) => TeamActionError | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite-by-email form. `owner` is never an option — see `console-roles.ts`'s `ASSIGNABLE_ROLES` doc comment. */
export function TeamInviteDialog({ open, onOpenChange, onInvite }: TeamInviteDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<BusinessTeamRole, "owner">>("marketer");
  const [error, setError] = useState<string | null>(null);
  const roleSelectId = useId();

  function reset() {
    setEmail("");
    setRole("marketer");
    setError(null);
  }

  function submitInvite() {
    if (!EMAIL_PATTERN.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    const failure = onInvite(email, role);
    if (failure) {
      setError(teamActionErrorMessage(failure));
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
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They&rsquo;ll receive an invite by email. They can accept it once it arrives — until
            then they show as pending.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitInvite();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            {...(error ? { errorMessage: error } : {})}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={roleSelectId} className="text-sm font-sans font-medium text-fg">
              Role
            </label>
            <select
              id={roleSelectId}
              value={role}
              onChange={(event) =>
                setRole(event.target.value as Exclude<BusinessTeamRole, "owner">)
              }
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ASSIGNABLE_ROLES.map((assignableRole) => (
                <option key={assignableRole} value={assignableRole}>
                  {ROLE_LABELS[assignableRole]}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send invite</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
