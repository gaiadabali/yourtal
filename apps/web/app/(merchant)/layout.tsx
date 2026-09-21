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
 * **It declares `id-ID`, and that is a deliberate hold rather than a
 * choice.** Nothing in this group resolves a region today: neither
 * `merchant-data.ts` nor either page reads the region cookie, and
 * `resolveMerchantRegionInfo()` takes a `Region` its callers never source
 * from a request. So there is no region here to render from. `id-ID` is
 * exactly what these pages already served under the old root layout, which
 * makes this change a no-op for the merchant portal specifically — no
 * behaviour moves, and the group stays statically rendered because nothing
 * new reads a cookie.
 *
 * Stating it explicitly is the point. Before, every surface was `id-ID`
 * because one hardcoded line covered all of them and nobody had decided
 * anything. Now `(app)` and `(public)` resolve their own locale and this
 * one is the single remaining hardcode, visible and commented, so it reads
 * as an open question rather than as a settled default.
 *
 * ⏭️ When the merchant portal gains a real region source — a logged-in
 * merchant's own region, not the visitor's cookie — this should render
 * from it. Staff in Australia are currently served `lang="id-ID"`, which
 * is wrong in the same way the public surface was, just on a surface no
 * crawler indexes and every user of which is known to us.
 */

export const metadata = baseMetadata;
export const viewport = baseViewport;

export interface MerchantLayoutProps {
  children: ReactNode;
}

export default function MerchantLayout({ children }: MerchantLayoutProps) {
  return <RootDocument lang="id-ID">{children}</RootDocument>;
}
