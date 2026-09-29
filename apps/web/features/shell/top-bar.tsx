"use client";

import Link from "next/link";
import { Input } from "@yourtal/ui/input";
import { PointsChip } from "@yourtal/ui/points-chip";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";
import { Wordmark } from "./wordmark";

export interface TopBarProps {
  locale: SupportedLocale;
  /** The signed-in viewer's spendable points, shown in the PointsChip. Ignored when `signedOut` is set. */
  availablePoints: number;
  /** Where the wordmark links home. Defaults to `/home` (the signed-in tab) — F79's anonymous caller passes its own public locale root instead. */
  homeHref?: string;
  /**
   * F79: renders "Sign up to earn" in place of the points chip, and drops
   * the search form — `/store?q=` has no anonymous-readable counterpart
   * (the public rewards catalogue this ticket also links from the nav has
   * no search of its own yet), and a search box that dead-ends is worse
   * than no search box.
   */
  signedOutCta?: { href: string; label: string };
}

/**
 * The viewer shell's top bar (task 3.5.c): wordmark, a real GET search form
 * and the available-points chip.
 *
 * `"use client"`: `@yourtal/ui/points-chip` calls `useMemo` without
 * declaring its own `"use client"` boundary, so it only renders safely
 * inside one — this is that boundary, kept to the smallest leaf that needs
 * it (`nav-link.tsx` gives the same reasoning for the nav's active-tab
 * logic). `Input` is already a client component for the same reason.
 *
 * `sticky`, not `fixed`: `RootDocument` renders the staging banner above
 * every `(app)` route; a fixed top bar would sit on top of it, exactly what
 * the brief for this task rules out.
 *
 * `lg:pl-56` clears the side rail (`side-nav.tsx`'s `w-56`, fixed to the
 * left edge from the same breakpoint): the header spans the full viewport
 * width, so without this the wordmark would render underneath the rail
 * instead of beside it — same value `<main>` uses in `viewer-shell.tsx` for
 * the same reason, using `pl-*`/`pr-*` rather than `px-*` so the two
 * breakpoints' left-padding declarations cleanly override each other
 * instead of both trying to set the same property with no defined winner.
 *
 * Search submits a real, JS-free GET to `/store?q=...` — no `onSubmit`, so
 * it works before hydration and with JS disabled.
 */
export function TopBar({ locale, availablePoints, homeHref = "/home", signedOutCta }: TopBarProps) {
  const t = getNavTranslator(locale);

  return (
    <header className="sticky top-0 z-(--z-nav) flex items-center gap-3 border-b border-border-subtle bg-surface pl-gutter-sm pr-gutter-sm py-2 md:pl-gutter-md md:pr-gutter-md lg:pl-56">
      {signedOutCta ? (
        // Plain `<a>`, not `next/link`: `homeHref` may be a public locale
        // route outside the signed-in tab graph `next/link`'s typed routes
        // resolve against — same reasoning `public-cta-link.tsx` gives.
        <a href={homeHref} className="shrink-0">
          <Wordmark />
        </a>
      ) : (
        <Link href="/home" className="shrink-0">
          <Wordmark />
        </Link>
      )}
      {signedOutCta ? (
        <div className="min-w-0 flex-1" />
      ) : (
        <form action="/store" method="get" role="search" className="min-w-0 flex-1">
          <Input
            type="search"
            name="q"
            label={t("searchLabel")}
            hideLabel
            placeholder={t("searchPlaceholder")}
          />
        </form>
      )}
      {signedOutCta ? (
        <a
          href={signedOutCta.href}
          className="inline-flex h-8 shrink-0 items-center rounded-pill bg-accent px-3 text-label font-sans font-bold text-fg-on-accent"
        >
          {signedOutCta.label}
        </a>
      ) : (
        <PointsChip
          value={availablePoints}
          size="sm"
          locale={locale}
          formatLabel={(formatted) => t("pointsAvailable", { points: formatted })}
          className="shrink-0"
        />
      )}
    </header>
  );
}
