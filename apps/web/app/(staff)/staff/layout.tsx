import type { ReactNode } from "react";
import { StaffChrome } from "@/features/staff/staff-chrome";
import { requireStaffSession } from "@/features/staff/staff-session";

export default async function StaffConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffSession();
  return <StaffChrome session={session}>{children}</StaffChrome>;
}
