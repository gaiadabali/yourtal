import type { BusinessTeamRole as StudioRole } from "@yourtal/contracts/business/team-role";

/**
 * Who may approve a cut to S: `business_team_editor_of` in
 * `policies/derived_roles/business.yaml` (owner, admin), and never the person who
 * raised it. A cosmetic mirror; the API and Cerbos decide.
 */
export function canApproveSettlementDecrease(role: StudioRole): boolean {
  return role === "owner" || role === "admin";
}
