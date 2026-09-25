import type { ReactNode } from "react";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

export const metadata = baseMetadata;
export const viewport = baseViewport;

/**
 * A root layout for `apps/web/app/dev/**` (1.6.b), the same way `(app)` and
 * `(merchant)` each own their own `<html>` — see `root-document.tsx`'s
 * header for why there is no single shared `app/layout.tsx` any more. This
 * one is deliberately the plainest of the three: no region cookie, no
 * next-intl provider, no app shell — a reviewer's tool, not a user surface,
 * so `lang="en-AU"` (the site default, 0.5.a) is fixed rather than derived.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en-AU">{children}</RootDocument>;
}
