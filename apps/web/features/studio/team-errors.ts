/**
 * Every reason a team action can be refused, as a discriminated union on
 * `type` (docs/13b-typescript-standards.md §4) — never a bare string.
 * Every consumer `switch`es exhaustively with a `never` default (see
 * `team-error-message.tsx`), mirroring `features/burn/burn-errors.ts`.
 *
 * These are UI-layer refusals for the mock flow, not the PDP's decision —
 * the same invariants `policies/resource_policies/team.yaml` enforces
 * server-side, restated here so the mock console degrades honestly instead
 * of pretending an action succeeded that the real backend would reject.
 */
export type TeamActionError =
  | { type: "cannot_target_owner_role" }
  | { type: "cannot_remove_owner" }
  | { type: "already_on_roster"; email: string }
  | { type: "reauth_required" }
  | { type: "reauth_expired" }
  | { type: "successor_not_a_member" };

export function teamActionErrorMessage(error: TeamActionError): string {
  switch (error.type) {
    case "cannot_target_owner_role":
      return "The Owner role can't be granted or removed here. Use “Transfer ownership” instead.";
    case "cannot_remove_owner":
      return "The Owner can't be removed from the team. Transfer ownership to someone else first.";
    case "already_on_roster":
      return `${error.email} is already a member or has a pending invite.`;
    case "reauth_required":
      return "Re-authenticate before transferring ownership — this is a fresh-session-only action.";
    case "reauth_expired":
      return "That re-authentication has expired (valid for 5 minutes). Re-authenticate again to continue.";
    case "successor_not_a_member":
      return "Ownership can only transfer to someone who has already joined the team.";
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
