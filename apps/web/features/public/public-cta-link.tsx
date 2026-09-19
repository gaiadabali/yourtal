import type { ReactNode } from "react";

export interface PublicCtaLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * The primary call-to-action link on every public entity page. A plain
 * `<a>` styled to read as a button, not `@yourtal/ui/button`'s `Button` —
 * that component is a `"use client"` leaf (it wraps Radix `Slot` for
 * `asChild`), and this ticket's routes are RSC-only with zero client
 * components by design (see this ticket's report on the bundle budget).
 * Plain anchor, not `next/link`: this always navigates to `/onboarding`
 * (outside the `(public)` group, inside the dynamic `(app)` shell), a real
 * full navigation this route should not speculatively prefetch — the same
 * reasoning `campaign-entry-card.tsx`'s watch link and
 * `store-offer-card.tsx`'s redeem link already give for their own
 * cross-group links.
 */
export function PublicCtaLink({ href, children }: PublicCtaLinkProps) {
  return (
    <a
      href={href}
      className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
  );
}
