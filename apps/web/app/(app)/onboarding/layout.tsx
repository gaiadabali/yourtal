import type { ReactNode } from "react";

export interface OnboardingLayoutProps {
  children: ReactNode;
}

/**
 * Full-bleed overlay for the whole onboarding flow.
 *
 * `app/(app)/layout.tsx` is SHARED across every route in this group and is
 * explicitly out of scope for this ticket — it wraps every child in the
 * five-tab shell (YT-0402: bottom nav on mobile, side rail from `md`).
 * Showing that chrome during signup would let a not-yet-registered visitor
 * tap into Wallet, Store or Me before an account exists, and it clutters
 * the one flow where speed is an acceptance criterion (docs/tasks/phase-u-ui.md
 * YT-0430: signup under 60 seconds). The right fix is for the shell itself
 * to hide its nav on `/onboarding/**`, which belongs to whoever owns
 * `features/shell/*` — flagged in this ticket's handback report rather
 * than done here.
 *
 * Until then: this layout is a `fixed inset-0` panel at `z-50`, one layer
 * above both `BottomNav` and `SideNav` (`z-40`, see `features/shell/*.tsx`),
 * with an opaque `bg-bg` background — it visually covers the shared shell
 * completely without editing it. `position: fixed` is relative to the
 * viewport regardless of the shell `<main>`'s own padding, so this covers
 * the full screen at every size.
 */
export default function OnboardingLayout({ children }: OnboardingLayoutProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-6 sm:py-10">{children}</div>
    </div>
  );
}
