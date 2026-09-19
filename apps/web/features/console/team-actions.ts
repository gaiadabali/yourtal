import type { BusinessMember } from "@yourtal/contracts/business/member";
import { hashStringToSeed } from "@yourtal/contracts/mock-seed";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import type { TeamActionError } from "./team-errors";

/**
 * Pure team-roster mutations, mirroring `features/burn/burn-redemption.ts`'s
 * shape: a discriminated `{ ok: true, ... } | { ok: false, error }` result,
 * never a thrown exception for an expected refusal
 * (docs/13b-typescript-standards.md §4). No live team-management API exists
 * yet (Phase U is mock-only), so these operate on an in-memory roster array
 * that `team-screen.tsx` holds in `useState` — when a real BFF exists, only
 * the call site changes, not this module's shape.
 *
 * This module is imported by `team-screen.tsx`, a `"use client"` leaf, so it
 * only ever `import type`s from `@yourtal/contracts/business/member` —
 * never the package's `businessMemberSchema` value. Every `BusinessMember`
 * built below is a plain object literal, not a `.parse()` call:
 * docs/13b-typescript-standards.md §3 is explicit that internal calls
 * between already-typed values do not re-parse ("the type system already
 * covers that, and the cost is real on the watch-session path") — the same
 * reasoning applies here, and a `.parse()` value import would additionally
 * drag Zod's ~96 KB gz into the Team zone's client bundle, exactly the
 * budget failure §8 calls out as having happened twice already.
 *
 * Every invariant below is restated from
 * `policies/resource_policies/team.yaml`, not invented:
 *   - `ownership-moves-only-by-transfer`: `change_role` and `remove_member`
 *     both refuse the instant `targetRole` (the role being GRANTED, for
 *     change_role) or the CURRENT role (for remove_member) is `"owner"`.
 *   - `ownership-transfer-needs-fresh-reauth`: `transfer_ownership` refuses
 *     without a re-authentication timestamp within the last 5 minutes.
 *   - `only-the-owner-transfers-or-deletes`: enforced one level up, by
 *     which capability the caller exposes at all (`console-zone-access.ts`
 *     doesn't cover this — it's checked directly in `team-screen.tsx`
 *     against the viewer's own role, same as the Cerbos rule's
 *     `business_owner_of` derived role).
 */
export type TeamActionResult<T> = { ok: true; value: T } | { ok: false; error: TeamActionError };

const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/** Mirrors `ownership-transfer-needs-fresh-reauth`'s `now() - reauthenticatedAt > duration("5m")` check. */
export function isReauthFresh(reauthenticatedAtMs: number | null, nowMs: number): boolean {
  return reauthenticatedAtMs !== null && nowMs - reauthenticatedAtMs <= REAUTH_WINDOW_MS;
}

function findMember(roster: readonly BusinessMember[], userId: string): BusinessMember | undefined {
  return roster.find((member) => member.userId === userId);
}

/** Deterministic mock id for a freshly-invited email — never random, so a repeated invite in a test is reproducible. */
function userIdFromEmail(email: string): string {
  const seed = hashStringToSeed(email.trim().toLowerCase())
    .toString(16)
    .padStart(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${seed}`;
}

export interface InviteMemberInput {
  roster: readonly BusinessMember[];
  businessId: string;
  email: string;
  role: Exclude<BusinessTeamRole, "owner">;
  invitedByUserId: string;
  nowIso: string;
}

export interface InviteMemberOutcome {
  roster: BusinessMember[];
  invitedMember: BusinessMember;
}

/** Invites a new member by email. Refuses a duplicate (already invited or joined) email. */
export function inviteMember(input: InviteMemberInput): TeamActionResult<InviteMemberOutcome> {
  const userId = userIdFromEmail(input.email);
  if (findMember(input.roster, userId)) {
    return { ok: false, error: { type: "already_on_roster", email: input.email } };
  }
  const invitedMember: BusinessMember = {
    businessId: input.businessId,
    userId,
    role: input.role,
    invitedAt: input.nowIso,
    invitedByUserId: input.invitedByUserId,
    joinedAt: null,
  };
  return { ok: true, value: { roster: [...input.roster, invitedMember], invitedMember } };
}

export interface ChangeRoleInput {
  roster: readonly BusinessMember[];
  targetUserId: string;
  newRole: Exclude<BusinessTeamRole, "owner">;
}

/** Reassigns an existing member's role. Refuses to touch the Owner row in either direction. */
export function changeMemberRole(input: ChangeRoleInput): TeamActionResult<BusinessMember[]> {
  const target = findMember(input.roster, input.targetUserId);
  if (!target || target.role === "owner") {
    return { ok: false, error: { type: "cannot_target_owner_role" } };
  }
  const updated = input.roster.map((member) =>
    member.userId === input.targetUserId ? { ...member, role: input.newRole } : member,
  );
  return { ok: true, value: updated };
}

/** Removes a member. Refuses to remove the Owner — the only door out of ownership is `transferOwnership`. */
export function removeMember(
  roster: readonly BusinessMember[],
  targetUserId: string,
): TeamActionResult<BusinessMember[]> {
  const target = findMember(roster, targetUserId);
  if (!target || target.role === "owner") {
    return { ok: false, error: { type: "cannot_remove_owner" } };
  }
  return { ok: true, value: roster.filter((member) => member.userId !== targetUserId) };
}

export interface TransferOwnershipInput {
  roster: readonly BusinessMember[];
  currentOwnerUserId: string;
  successorUserId: string;
  reauthenticatedAtMs: number | null;
  nowMs: number;
  nowIso: string;
}

/**
 * Transfers ownership to an existing, already-joined member. The prior
 * Owner becomes an Admin (docs/17 §2.1 lists Owner and Admin as running
 * the team identically otherwise, so this is the least-surprising landing
 * role — never removed outright, which would lock the very person
 * completing the transfer out mid-flow).
 */
export function transferOwnership(
  input: TransferOwnershipInput,
): TeamActionResult<BusinessMember[]> {
  if (input.reauthenticatedAtMs === null) {
    return { ok: false, error: { type: "reauth_required" } };
  }
  if (!isReauthFresh(input.reauthenticatedAtMs, input.nowMs)) {
    return { ok: false, error: { type: "reauth_expired" } };
  }
  const successor = findMember(input.roster, input.successorUserId);
  if (!successor || !successor.joinedAt) {
    return { ok: false, error: { type: "successor_not_a_member" } };
  }
  const updated = input.roster.map((member) => {
    if (member.userId === input.successorUserId) {
      return { ...member, role: "owner" as const };
    }
    if (member.userId === input.currentOwnerUserId) {
      return { ...member, role: "admin" as const };
    }
    return member;
  });
  return { ok: true, value: updated };
}
