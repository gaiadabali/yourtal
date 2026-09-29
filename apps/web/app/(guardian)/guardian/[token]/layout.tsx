import type { ReactNode } from "react";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface GuardianLayoutProps {
  children: ReactNode;
}

/**
 * Root layout for `/guardian/[token]` (12.2.c) — its own sibling route
 * group, the same reason `(merchant)`/`(auth)` are their own groups (see
 * `app/root-document.tsx`'s header): there is no shared `app/layout.tsx`
 * any more, so a group needs one wherever it needs `<html>`/`<body>`.
 *
 * `lang` is a fixed `"en-AU"`, not read from the guardian record: this
 * page must not read a cookie at all (12.2.c's own brief — there is no
 * session, the token IS the credential), and the teen's own `locale`
 * (which decides the CONTENT's language, via `guardian-i18n.ts`) is only
 * known after `GET /api/guardian/:token` resolves, inside the page below,
 * not up here. A fixed default matches `(merchant)/layout.tsx`'s own
 * fallback for the same "not yet known" case, and CLAUDE.md's own "en-AU
 * is the default."
 */
export default function GuardianLayout({ children }: GuardianLayoutProps) {
  return <RootDocument lang="en-AU">{children}</RootDocument>;
}
