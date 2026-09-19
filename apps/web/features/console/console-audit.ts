import type { BusinessMember } from "@yourtal/contracts/business/member";
import { getMemberProfile } from "./console-member-directory";
import { ROLE_LABELS } from "./console-roles";

/**
 * The Team zone's audit trail (docs/17 §2.1: "Every team action is
 * audit-logged and visible to the business itself, not just to us";
 * YT-0444 AC: "the audit trail of team actions"). No audit-log contract
 * exists in `packages/contracts` yet — like `WalletHistoryEntry`
 * (`features/wallet/wallet-history.ts`), this is a console-local, UI-only
 * shape derived from real fields already on `BusinessMember`
 * (`invitedAt`/`invitedByUserId`/`joinedAt`), not an invented wire
 * contract, so it needs no architect sign-off to exist here.
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

export interface TeamAuditEntry {
  id: string;
  occurredAt: string;
  action: TeamAuditAction;
  /** Plain-language sentence, never a transaction-code style string (docs/17 §3's rule applied here too). */
  description: string;
}

function inviteEntry(member: BusinessMember): TeamAuditEntry {
  const invited = getMemberProfile(member.userId);
  const invitedBy = getMemberProfile(member.invitedByUserId);
  return {
    id: `invite-${member.userId}`,
    occurredAt: member.invitedAt,
    action: "invited",
    description: `${invitedBy.name} invited ${invited.name} as ${ROLE_LABELS[member.role]}`,
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
    description: `${joined.name} accepted the invite and joined as ${ROLE_LABELS[member.role]}`,
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
