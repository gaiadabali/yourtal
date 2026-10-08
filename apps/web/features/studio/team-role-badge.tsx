"use client";

import { useTranslations } from "next-intl";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import { Badge } from "@yourtal/ui/badge";
import { roleLabel } from "./studio-roles";

export interface TeamRoleBadgeProps {
  role: BusinessTeamRole;
}

/** Owner gets its own visual weight (docs/17 §2.1: "exactly one Owner") — everyone else is a plain secondary badge. */
export function TeamRoleBadge({ role }: TeamRoleBadgeProps) {
  const t = useTranslations("studio");
  return <Badge variant={role === "owner" ? "reward" : "secondary"}>{roleLabel(t, role)}</Badge>;
}
