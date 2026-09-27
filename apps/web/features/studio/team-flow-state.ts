/**
 * The Team screen's dialog state as a discriminated union on `dialog`
 * (docs/13b-typescript-standards.md §4's pattern applied to UI flow state,
 * as `features/burn/burn-flow-state.ts` already does) — never independent
 * booleans that could contradict each other (e.g. a remove confirmation
 * and a change-role form both open at once).
 */
export type TeamDialogState =
  | { dialog: "none" }
  | { dialog: "invite" }
  | { dialog: "change_role"; targetUserId: string }
  | { dialog: "remove"; targetUserId: string }
  | { dialog: "transfer" };
