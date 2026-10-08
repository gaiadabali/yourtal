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
  | { type: "successor_not_a_member" }
  /** A real API refusal (`team-live-actions.ts`) with no closer match above — the server's own message, not a guess. */
  | { type: "api_error"; message: string };

export function teamActionErrorMessage(
  error: TeamActionError,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  switch (error.type) {
    case "cannot_target_owner_role":
      return t("team.errors.cannotTargetOwnerRole");
    case "cannot_remove_owner":
      return t("team.errors.cannotRemoveOwner");
    case "already_on_roster":
      return t("team.errors.alreadyOnRoster", { email: error.email });
    case "reauth_required":
      return t("team.errors.reauthRequired");
    case "reauth_expired":
      return t("team.errors.reauthExpired");
    case "successor_not_a_member":
      return t("team.errors.successorNotAMember");
    case "api_error":
      return error.message;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
