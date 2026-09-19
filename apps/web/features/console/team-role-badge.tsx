import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { Badge } from "@yourtal/ui/badge";
import { ROLE_LABELS } from "./console-roles";

export interface TeamRoleBadgeProps {
  role: BusinessTeamRole;
}

/** Owner gets its own visual weight (docs/17 §2.1: "exactly one Owner") — everyone else is a plain secondary badge. */
export function TeamRoleBadge({ role }: TeamRoleBadgeProps) {
  return <Badge variant={role === "owner" ? "reward" : "secondary"}>{ROLE_LABELS[role]}</Badge>;
}
