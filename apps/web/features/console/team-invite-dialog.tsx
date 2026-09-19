"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
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

interface InviteFormValues {
  email: string;
  role: Exclude<BusinessTeamRole, "owner">;
}

const DEFAULT_VALUES: InviteFormValues = { email: "", role: "marketer" };

/**
 * Invite-by-email form. `owner` is never an option — see `console-roles.ts`'s
 * `ASSIGNABLE_ROLES` doc comment.
 *
 * Migrated to React Hook Form (YT-0525): two real, named fields (email,
 * role) with an actual validation rule (email format), which is exactly the
 * shape RHF is for. No Zod schema exists for this two-field dialog and none
 * is added — `register`'s own `required`/`pattern` rules replace the old
 * hand-rolled regex check, matching what this form already checked and
 * nothing more.
 */
export function TeamInviteDialog({ open, onOpenChange, onInvite }: TeamInviteDialogProps) {
  const roleSelectId = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteFormValues>({ defaultValues: DEFAULT_VALUES });

  function submitInvite(values: InviteFormValues) {
    const failure = onInvite(values.email, values.role);
    if (failure) {
      setError("email", { type: "server", message: teamActionErrorMessage(failure) });
      return;
    }
    reset(DEFAULT_VALUES);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset(DEFAULT_VALUES);
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
          onSubmit={(event) => void handleSubmit(submitInvite)(event)}
          className="flex flex-col gap-4"
        >
          <Input
            label="Email"
            type="email"
            required
            {...register("email", {
              required: "Enter a valid email address.",
              pattern: { value: EMAIL_PATTERN, message: "Enter a valid email address." },
            })}
            {...(errors.email?.message ? { errorMessage: errors.email.message } : {})}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={roleSelectId} className="text-sm font-sans font-medium text-fg">
              Role
            </label>
            <select
              id={roleSelectId}
              {...register("role")}
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
