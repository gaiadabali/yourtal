"use client";

import Link from "next/link";
import { Input } from "@yourtal/ui/input";
import { PointsChip } from "@yourtal/ui/points-chip";
import { getNavTranslator, type SupportedLocale } from "./nav-i18n";
import { Wordmark } from "./wordmark";

export interface TopBarProps {
  locale: SupportedLocale;
  /** The signed-in viewer's spendable points, shown in the PointsChip. */
  availablePoints: number;
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
export function TopBar({ locale, availablePoints }: TopBarProps) {
  const t = getNavTranslator(locale);

  return (
    <header className="sticky top-0 z-(--z-nav) flex items-center gap-3 border-b border-border-subtle bg-surface pl-gutter-sm pr-gutter-sm py-2 md:pl-gutter-md md:pr-gutter-md lg:pl-56">
      <Link href="/" className="shrink-0">
        <Wordmark />
      </Link>
      <form action="/store" method="get" role="search" className="min-w-0 flex-1">
        <Input
          type="search"
          name="q"
          label={t("searchLabel")}
          hideLabel
          placeholder={t("searchPlaceholder")}
        />
      </form>
      <PointsChip
        value={availablePoints}
        size="sm"
        locale={locale}
        formatLabel={(formatted) => t("pointsAvailable", { points: formatted })}
        className="shrink-0"
      />
    </header>
  );
}
