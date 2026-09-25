import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { isStaging } from "@/features/shell/app-env";
import { StagingBanner } from "@/features/shell/staging-banner";

import "./globals.css";

/**
 * The shared `<html>`/`<body>` shell, factored out of what used to be a
 * single `app/layout.tsx`.
 *
 * **Why there is no longer one root layout.** The old root layout wrote
 * `<html lang="id-ID">` unconditionally, because a root layout sits above
 * every route group and so cannot see the `[locale]` segment that only
 * exists under `(public)`, and cannot read the region cookie without
 * forcing the entire app — including the deliberately static public
 * surface (`docs/11-seo-aeo-geo.md` §1) — to render dynamically. The
 * result was that **every page on the site, `/au` included, declared
 * itself Indonesian to crawlers**: wrong, and invisible, because no human
 * ever sees `lang`. With AU as the primary market that disqualified the
 * whole Australian public surface for the market it exists to serve, and
 * it made hreflang incoherent — an `en-AU` alternate pointing at a page
 * whose `<html>` says `id-ID` is a contradiction a crawler resolves
 * against us. Found by `yourtal-54` in built output under YT-0181.
 *
 * Next.js's own answer is **multiple root layouts**: delete the shared
 * `app/layout.tsx` and let each route group own its own `<html>`. Each
 * group then resolves `lang` from whatever it legitimately knows —
 * `(public)` from its URL segment while staying static, `(app)` from the
 * region cookie it already reads. This file is what they share, so the
 * font, metadata and viewport stay defined once.
 *
 * The fonts must be instantiated here rather than per group: calling them
 * in three files would emit three copies and download each more than once.
 */

// Figtree for body, Bricolage Grotesque for display, JetBrains Mono for codes.
// Latin only: Indonesian needs no diacritics, so latin-ext would only add weight.
const fontBody = Figtree({ subsets: ["latin"], display: "swap", variable: "--font-body-app" });
const fontDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-display-app",
});
const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-mono-app",
});
const fontVariables = `${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`;

export const baseMetadata: Metadata = {
  title: "YourTal",
  description: "Watch, learn, earn — and spend it where you live.",
  // robots.txt already disallows staging; this covers crawlers that arrive by link.
  ...(isStaging() ? { robots: { index: false, follow: false } } : {}),
};

// Safe-area insets for notched devices (YT-0402).
export const baseViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export interface RootDocumentProps {
  /**
   * A BCP-47 tag — `"id-ID"` or `"en-AU"`, never the `"id"`/`"au"` route
   * segment. The two vocabularies are genuinely different strings in this
   * codebase (`features/public/public-locale.ts` maps one to the other),
   * and `lang` takes the BCP-47 one.
   */
  lang: string;
  children: ReactNode;
}

export function RootDocument({ lang, children }: RootDocumentProps) {
  return (
    <html lang={lang} suppressHydrationWarning className={fontVariables}>
      <body>
        {isStaging() ? <StagingBanner lang={lang} /> : null}
        {children}
      </body>
    </html>
  );
}
