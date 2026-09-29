import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";

/**
 * Root layout for the bare `/` public landing page (11.1.a), a sibling
 * route group to `(public)` rather than a child of it — see this ticket's
 * report for why. `(public)/[locale]/layout.tsx` already calls
 * `RootDocument` for `/au`/`/id`; nesting this page under that same group
 * would call it a second time (two `<html>` elements), so it gets its own
 * top-level group instead, the same move `(merchant)/layout.tsx` already
 * made for the same reason (`app/root-document.tsx`'s own header explains
 * "multiple root layouts").
 *
 * `lang="en-AU"` unconditionally: this page has no `[locale]` segment and
 * is never region-specific (it is the chooser a visitor sees BEFORE
 * picking one) — English is the platform default (CLAUDE.md).
 *
 * No `cookies()`/`headers()` anywhere in this tree, so the page stays
 * static/ISR — the whole point of 11.1.a's "no IP redirect" requirement.
 */
export const metadata: Metadata = { ...baseMetadata, metadataBase: new URL(PUBLIC_SITE_URL) };
export const viewport = baseViewport;

export default function LandingLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en-AU">{children}</RootDocument>;
}
