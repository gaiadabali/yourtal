import type { ReactNode } from "react";

import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";

/**
 * Root layout for the merchant portal (YT-0181).
 *
 * This group had no layout of its own and inherited `<html>` from the old
 * shared `app/layout.tsx`. That file is gone — see `app/root-document.tsx`
 * for why — so the group needs one, and the only real question it raises
 * is which `lang` to declare.
 *
 * TASKS.md 8.1/8.2 REWRITE: `lang` used to follow the paired device's own
 * locale, read off the binding cookie. Pairing (`POST /api/devices/pair`)
 * no longer returns a locale — see `merchant-i18n.ts`'s doc comment on the
 * device-info gap — so this is a fixed `en-AU` until that endpoint exists.
 */

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface MerchantLayoutProps {
  children: ReactNode;
}

export default function MerchantLayout({ children }: MerchantLayoutProps) {
  return <RootDocument lang="en-AU">{children}</RootDocument>;
}
