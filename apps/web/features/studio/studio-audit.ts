import type { BusinessMember } from "@yourtal/contracts/business/member";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { getMemberProfile } from "./studio-member-directory";
import { roleLabel } from "./studio-roles";

/**
 * The Team zone's audit trail (docs/17 §2.1: "Every team action is
 * audit-logged and visible to the business itself, not just to us";
 * YT-0444 AC: "the audit trail of team actions"). No audit-log contract
 * exists in `packages/contracts` yet — like `WalletHistoryEntry`
 * (`features/wallet/wallet-history.ts`), this is a studio-local, UI-only
 * shape derived from real fields already on `BusinessMember`
 * (`invitedAt`/`invitedByUserId`/`joinedAt`), not an invented wire
 * contract, so it needs no architect sign-off to exist here.
 *
 * An entry holds a message key and its parameters, never a finished
 * sentence: `describeAuditEntry` words it in the viewer's language when it is
 * shown, so a locale switch re-words history already on screen.
 *
 * `buildTeamAuditTrail` covers the roster's own history (invites and
 * acceptances); `team-screen.tsx` appends further entries for actions
 * taken live in the current session (role changes, removals, ownership
 * transfers) — those have no field on `BusinessMember` to derive from
 * because `BusinessMember` only ever represents the CURRENT state, not the
 * history of how it got there.
 */
export type TeamAuditAction =
  "invited" | "joined" | "role_changed" | "removed" | "ownership_transferred";

/** The catalogue key under `team.audit.*` that words the entry. */
export type TeamAuditMessage =
  | "invited"
  | "invitedByYou"
  | "joined"
  | "roleChanged"
  | "roleChangedTo"
  | "removed"
  | "ownershipTransferred";

export interface TeamAuditParams {
  /** Who did it, when it was not the viewer. */
  actor?: string;
  /** Who it was done to. */
  name: string;
  role?: BusinessTeamRole;
  fromRole?: BusinessTeamRole;
  toRole?: BusinessTeamRole;
}

export interface TeamAuditEntry {
  id: string;
  occurredAt: string;
  action: TeamAuditAction;
  message: TeamAuditMessage;
  params: TeamAuditParams;
}

/** Plain-language sentence for an entry (docs/17 §3's rule: never a transaction-code string). */
export function describeAuditEntry(
  entry: TeamAuditEntry,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const { actor, name, role, fromRole, toRole } = entry.params;
  const values: Record<string, string> = { name };
  if (actor) values.actor = actor;
  if (role) values.role = roleLabel(t, role);
  if (fromRole) values.fromRole = roleLabel(t, fromRole);
  if (toRole) values.toRole = roleLabel(t, toRole);
  return t(`team.audit.${entry.message}`, values);
}

function inviteEntry(member: BusinessMember): TeamAuditEntry {
  const invited = getMemberProfile(member.userId);
  const invitedBy = getMemberProfile(member.invitedByUserId);
  return {
    id: `invite-${member.userId}`,
    occurredAt: member.invitedAt,
    action: "invited",
    message: "invited",
    params: { actor: invitedBy.name, name: invited.name, role: member.role },
  };
}

function joinEntry(member: BusinessMember): TeamAuditEntry | null {
  if (!member.joinedAt) {
    return null;
  }
  const joined = getMemberProfile(member.userId);
  return {
    id: `join-${member.userId}`,
    occurredAt: member.joinedAt,
    action: "joined",
    message: "joined",
    params: { name: joined.name, role: member.role },
  };
}

/** Builds and time-sorts (newest first) the roster's invite/join history. */
export function buildTeamAuditTrail(roster: readonly BusinessMember[]): TeamAuditEntry[] {
  const entries: TeamAuditEntry[] = [];
  for (const member of roster) {
    entries.push(inviteEntry(member));
    const join = joinEntry(member);
    if (join) {
      entries.push(join);
    }
  }
  return entries.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
