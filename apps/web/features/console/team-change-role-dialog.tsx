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
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "./console-roles";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TeamChangeRoleDialogProps {
  open: boolean;
  targetName: string;
  currentRole: Exclude<BusinessTeamRole, "owner">;
  /** Whether the viewer is changing their OWN role — see the "losing Team access" warning below. */
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeRole: (newRole: Exclude<BusinessTeamRole, "owner">) => TeamActionError | null;
}

/** Roles that keep Team-zone access (`policies/derived_roles/business.yaml`'s `business_team_editor_of`: owner, admin). */
const ROLES_WITH_TEAM_ACCESS: readonly Exclude<BusinessTeamRole, "owner">[] = ["admin"];

/**
 * `currentRole` is typed to exclude `"owner"` — the caller
 * (`team-roster-table.tsx`) never offers this dialog for the Owner row at
 * all (ownership only moves through `TeamTransferOwnershipDialog`), so
 * there is no "what if the target is already Owner" branch to handle here.
 */
export function TeamChangeRoleDialog({
  open,
  targetName,
  currentRole,
  isSelf,
  onOpenChange,
  onChangeRole,
}: TeamChangeRoleDialogProps) {
  const [role, setRole] = useState<Exclude<BusinessTeamRole, "owner">>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const roleSelectId = useId();
  const losesTeamAccess = isSelf && !ROLES_WITH_TEAM_ACCESS.includes(role);

  function handleConfirm() {
    const failure = onChangeRole(role);
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
          setRole(currentRole);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {targetName}&rsquo;s role</DialogTitle>
          <DialogDescription>This takes effect immediately.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={roleSelectId} className="text-sm font-sans font-medium text-fg">
            New role
          </label>
          <select
            id={roleSelectId}
            value={role}
            onChange={(event) => setRole(event.target.value as Exclude<BusinessTeamRole, "owner">)}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ASSIGNABLE_ROLES.map((assignableRole) => (
              <option key={assignableRole} value={assignableRole}>
                {ROLE_LABELS[assignableRole]}
              </option>
            ))}
          </select>
          {losesTeamAccess ? (
            <p role="alert" className="text-xs font-sans text-warning">
              You will lose access to Team management immediately after this change.
            </p>
          ) : null}
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
          <Button type="button" onClick={handleConfirm} disabled={role === currentRole}>
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
