import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

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
 * The font must be instantiated here rather than per group: calling
 * `Plus_Jakarta_Sans()` in three files would emit three separate
 * `--font-sans-app` faces and download the file more than once.
 */

// YT-0400: one variable font (weight axis 200–800 in a single file),
// subset to Latin. Indonesian is written with the plain 26-letter Latin
// alphabet — no diacritics, no extended punctuation — so the standard
// `latin` subset (Basic Latin + the small set of common Latin-1
// punctuation/currency glyphs Google ships with it, verified against the
// "Rp" price strings and "×"/"–" characters used in copy) fully covers
// it. `latin-ext` adds accented forms (e.g. Ā, Ł, ő) for languages like
// Vietnamese or Polish, which this product does not target, so it is
// deliberately left out to keep the download small.
const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-app",
});

export const baseMetadata: Metadata = {
  title: "YourTal",
  description: "Watch, learn, earn — and spend it where you live.",
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
    <html lang={lang} suppressHydrationWarning className={fontSans.variable}>
      <body>{children}</body>
    </html>
  );
}
