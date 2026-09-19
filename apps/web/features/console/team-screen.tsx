"use client";

import { useState } from "react";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { buildTeamAuditTrail } from "./console-audit";
import type { TeamAuditEntry } from "./console-audit";
import { getMemberProfile } from "./console-member-directory";
import { ROLE_LABELS } from "./console-roles";
import { changeMemberRole, inviteMember, removeMember, transferOwnership } from "./team-actions";
import { TeamAuditTrail } from "./team-audit-trail";
import { TeamChangeRoleDialog } from "./team-change-role-dialog";
import type { TeamDialogState } from "./team-flow-state";
import { TeamInviteDialog } from "./team-invite-dialog";
import { TeamRemoveDialog } from "./team-remove-dialog";
import { TeamRosterTable } from "./team-roster-table";
import type { TeamRosterRow } from "./team-roster-table";
import { TeamTransferDialog } from "./team-transfer-dialog";
import type { TransferCandidate } from "./team-transfer-dialog";
import type { TeamActionError } from "./team-errors";

export interface TeamScreenProps {
  businessId: string;
  businessDisplayName: string;
  currentUserId: string;
  /** The viewer's role when this screen mounted. Team-zone view already requires owner or admin (`console-zone-access.ts`), enforced one level up in `page.tsx` before this component ever renders. */
  initialViewerRole: Extract<BusinessTeamRole, "owner" | "admin">;
  initialRoster: BusinessMember[];
}

/**
 * The Team zone (YT-0444): roster, invite/change-role/remove/transfer, and
 * the audit trail — the one client leaf for the whole zone, mirroring
 * `features/burn/burn-flow.tsx`'s "one leaf owns the whole flow's state"
 * shape. No live team-management API exists yet (Phase U is mock-only), so
 * every mutation runs against local state via the pure functions in
 * `team-actions.ts`; the moment a real BFF exists, only this component's
 * handlers change to calls against it, not `team-actions.ts`'s shape.
 *
 * Two-person approval does NOT appear anywhere in this screen. YT-0444's
 * brief asks for "two-person-approval flows ... for the actions that
 * require them" — but per `policies/resource_policies/team.yaml`, none of
 * invite / change_role / remove_member / transfer_ownership require a
 * second approver. The two-person-approval rules
 * (`policies/tests/two_person_approval_test.yaml`) apply to bulk voucher
 * issuance, a material settlement-value decrease, and API credential
 * rotation — none of which is a `team` resource action. Showing a
 * two-person flow here would imply a control this business does not
 * actually have. See this ticket's report for the full discrepancy.
 */
export function TeamScreen({
  businessId,
  businessDisplayName,
  currentUserId,
  initialViewerRole,
  initialRoster,
}: TeamScreenProps) {
  const [roster, setRoster] = useState<BusinessMember[]>(initialRoster);
  const [pendingEmails, setPendingEmails] = useState<Record<string, string>>({});
  const [auditEntries, setAuditEntries] = useState<TeamAuditEntry[]>(() =>
    buildTeamAuditTrail(initialRoster),
  );
  const [viewerRole, setViewerRole] =
    useState<Extract<BusinessTeamRole, "owner" | "admin">>(initialViewerRole);
  const [dialogState, setDialogState] = useState<TeamDialogState>({ dialog: "none" });
  const [selfRemoved, setSelfRemoved] = useState(false);

  function appendAudit(description: string, action: TeamAuditEntry["action"]) {
    setAuditEntries((current) => [
      {
        id: `${action}-live-${current.length}-${Date.now()}`,
        occurredAt: new Date().toISOString(),
        action,
        description,
      },
      ...current,
    ]);
  }

  /** Name/email only — never needs the member to already be found in `roster`, unlike `resolveRow`. */
  function resolveProfile(userId: string): { name: string; email: string } {
    const pendingEmail = pendingEmails[userId];
    if (pendingEmail) {
      return { name: pendingEmail, email: pendingEmail };
    }
    return getMemberProfile(userId);
  }

  function resolveRow(member: BusinessMember): TeamRosterRow {
    const { name, email } = resolveProfile(member.userId);
    return { member, name, email };
  }

  if (selfRemoved) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">You&rsquo;ve left {businessDisplayName}&rsquo;s team</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-sans text-fg-muted">
            You no longer have access to this business console. Ask an Owner or Admin there to
            invite you back.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows = roster.map(resolveRow);
  const owner = roster.find((member) => member.role === "owner");
  const transferCandidates: TransferCandidate[] = roster
    .filter((member) => member.role !== "owner" && member.joinedAt)
    .map((member) => ({ userId: member.userId, name: resolveRow(member).name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-sans font-semibold text-fg">Team</h2>
        <Button type="button" onClick={() => setDialogState({ dialog: "invite" })}>
          Invite member
        </Button>
      </div>

      <p className="text-xs font-sans text-fg-subtle">
        Invites, role changes and removals here take effect immediately once an Owner or Admin
        confirms them — transferring ownership additionally needs a fresh re-authentication.
        Two-person approval (a second person confirming a different person&rsquo;s request) applies
        elsewhere in the console — bulk voucher issuance, a material settlement-value cut, and API
        credential rotation — not to team membership itself.
      </p>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <TeamRosterTable
            rows={rows}
            currentUserId={currentUserId}
            viewerIsOwner={viewerRole === "owner"}
            onChangeRole={(targetUserId) => setDialogState({ dialog: "change_role", targetUserId })}
            onRemove={(targetUserId) => setDialogState({ dialog: "remove", targetUserId })}
            onTransferOwnership={() => setDialogState({ dialog: "transfer" })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3">Audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamAuditTrail entries={auditEntries} />
        </CardContent>
      </Card>

      <TeamInviteDialog
        open={dialogState.dialog === "invite"}
        onOpenChange={(open) => setDialogState(open ? { dialog: "invite" } : { dialog: "none" })}
        onInvite={(email, role) => {
          const result = inviteMember({
            roster,
            businessId,
            email,
            role,
            invitedByUserId: currentUserId,
            nowIso: new Date().toISOString(),
          });
          if (!result.ok) {
            return result.error;
          }
          setRoster(result.value.roster);
          setPendingEmails((current) => ({
            ...current,
            [result.value.invitedMember.userId]: email,
          }));
          appendAudit(`You invited ${email} as ${ROLE_LABELS[role]}`, "invited");
          return null;
        }}
      />

      {dialogState.dialog === "change_role" ? (
        <TeamChangeRoleDialogHost
          dialogState={dialogState}
          roster={roster}
          currentUserId={currentUserId}
          resolveName={(userId) => resolveProfile(userId).name}
          onClose={() => setDialogState({ dialog: "none" })}
          onChangeRole={(targetUserId, newRole) => {
            const before = roster.find((member) => member.userId === targetUserId);
            const result = changeMemberRole({ roster, targetUserId, newRole });
            if (!result.ok) {
              return result.error;
            }
            setRoster(result.value);
            const name = resolveProfile(targetUserId).name;
            appendAudit(
              `${name}'s role changed from ${before ? ROLE_LABELS[before.role] : "?"} to ${ROLE_LABELS[newRole]}`,
              "role_changed",
            );
            if (targetUserId === currentUserId && newRole === "admin") {
              setViewerRole(newRole);
            } else if (targetUserId === currentUserId) {
              // The viewer just gave up owner/admin access — Team view itself is gated to those two roles
              // (console-zone-access.ts), so there is nothing left in this zone to show them.
              setSelfRemoved(true);
            }
            return null;
          }}
        />
      ) : null}

      {dialogState.dialog === "remove" ? (
        <TeamRemoveDialog
          open
          targetName={resolveProfile(dialogState.targetUserId).name}
          isSelf={dialogState.targetUserId === currentUserId}
          onOpenChange={(open) => setDialogState(open ? dialogState : { dialog: "none" })}
          onConfirm={() => {
            const removedName = resolveProfile(dialogState.targetUserId).name;
            const result = removeMember(roster, dialogState.targetUserId);
            if (!result.ok) {
              return result.error;
            }
            setRoster(result.value);
            appendAudit(`${removedName} was removed from the team`, "removed");
            if (dialogState.targetUserId === currentUserId) {
              setSelfRemoved(true);
            }
            return null;
          }}
        />
      ) : null}

      <TeamTransferDialog
        open={dialogState.dialog === "transfer"}
        candidates={transferCandidates}
        onOpenChange={(open) => setDialogState(open ? { dialog: "transfer" } : { dialog: "none" })}
        onReauthenticate={(password) => (password.length > 0 ? Date.now() : null)}
        onTransfer={(successorUserId, reauthenticatedAtMs) => {
          const result = transferOwnership({
            roster,
            currentOwnerUserId: currentUserId,
            successorUserId,
            reauthenticatedAtMs,
            nowMs: Date.now(),
            nowIso: new Date().toISOString(),
          });
          if (!result.ok) {
            return result.error;
          }
          setRoster(result.value);
          setViewerRole("admin");
          const successorName =
            transferCandidates.find((candidate) => candidate.userId === successorUserId)?.name ??
            "a team member";
          appendAudit(`You transferred ownership to ${successorName}`, "ownership_transferred");
          return null;
        }}
      />

      {!owner ? (
        <p role="alert" className="text-xs font-sans text-danger">
          This business has no recorded Owner — this should never happen; contact support.
        </p>
      ) : null}
    </div>
  );
}

interface TeamChangeRoleDialogHostProps {
  dialogState: Extract<TeamDialogState, { dialog: "change_role" }>;
  roster: BusinessMember[];
  currentUserId: string;
  resolveName: (userId: string) => string;
  onClose: () => void;
  onChangeRole: (
    targetUserId: string,
    newRole: Exclude<BusinessTeamRole, "owner">,
  ) => TeamActionError | null;
}

/** Small adapter so `team-screen.tsx`'s JSX above stays readable — looks up the target member once and renders the dialog bound to it. */
function TeamChangeRoleDialogHost({
  dialogState,
  roster,
  currentUserId,
  resolveName,
  onClose,
  onChangeRole,
}: TeamChangeRoleDialogHostProps) {
  const target = roster.find((member) => member.userId === dialogState.targetUserId);
  if (!target || target.role === "owner") {
    return null;
  }
  return (
    <TeamChangeRoleDialog
      open
      targetName={resolveName(target.userId)}
      currentRole={target.role}
      isSelf={target.userId === currentUserId}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      onChangeRole={(newRole) => {
        const error = onChangeRole(target.userId, newRole);
        if (!error) {
          onClose();
        }
        return error;
      }}
    />
  );
}
