"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { Button } from "@yourtal/ui/button";
import { NativeSelect } from "@yourtal/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { ASSIGNABLE_ROLES, roleLabel } from "./studio-roles";
import type { TeamActionError } from "./team-errors";
import { teamActionErrorMessage } from "./team-errors";

export interface TeamChangeRoleDialogProps {
  open: boolean;
  targetName: string;
  currentRole: Exclude<BusinessTeamRole, "owner">;
  /** Whether the viewer is changing their OWN role — see the "losing Team access" warning below. */
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeRole: (
    newRole: Exclude<BusinessTeamRole, "owner">,
  ) => TeamActionError | null | Promise<TeamActionError | null>;
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
  const t = useTranslations("studio");
  const [role, setRole] = useState<Exclude<BusinessTeamRole, "owner">>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const roleSelectId = useId();
  const losesTeamAccess = isSelf && !ROLES_WITH_TEAM_ACCESS.includes(role);

  async function handleConfirm() {
    const failure = await onChangeRole(role);
    if (failure) {
      setError(teamActionErrorMessage(failure, t));
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
          <DialogTitle>{t("team.changeRole.title", { name: targetName })}</DialogTitle>
          <DialogDescription>{t("team.changeRole.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <NativeSelect
            label={t("team.changeRole.newRoleLabel")}
            id={roleSelectId}
            value={role}
            onChange={(event) => setRole(event.target.value as Exclude<BusinessTeamRole, "owner">)}
          >
            {ASSIGNABLE_ROLES.map((assignableRole) => (
              <option key={assignableRole} value={assignableRole}>
                {roleLabel(t, assignableRole)}
              </option>
            ))}
          </NativeSelect>
          {losesTeamAccess ? (
            <p role="alert" className="text-xs font-sans text-warning">
              {t("team.changeRole.losesAccessWarning")}
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
            {t("team.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={role === currentRole}
          >
            {t("team.changeRole.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
