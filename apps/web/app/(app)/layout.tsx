import type { ReactNode } from "react";
import { AppShell } from "@/features/shell/app-shell";

export interface AppLayoutProps {
  children: ReactNode;
}

// YT-0402 — the shell for every tab route. Deliberately NOT "use client":
// per docs/13b-typescript-standards.md §8, "use client" never belongs on
// layout.tsx (it would drag this entire subtree — every route below — into
// the client bundle). AppShell and everything it renders directly are
// Server Components; see apps/web/features/shell/nav-link.tsx for the one
// client leaf in the tree and the reasoning for why it exists.
export default function AppLayout({ children }: AppLayoutProps) {
  return <AppShell>{children}</AppShell>;
}
