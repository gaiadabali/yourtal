import type { ReactNode } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { AppShell } from "@/features/shell/app-shell";
import { getRegion } from "@/features/region/get-region";
import { RegionProvider } from "@/features/region/region-context";

export interface AppLayoutProps {
  children: ReactNode;
}

// YT-0402 — the shell for every tab route. Deliberately NOT "use client":
// per docs/13b-typescript-standards.md §8, "use client" never belongs on
// layout.tsx (it would drag this entire subtree — every route below — into
// the client bundle). AppShell and everything it renders directly are
// Server Components; see apps/web/features/shell/nav-link.tsx for the one
// client leaf in the tree and the reasoning for why it exists.
//
// YT-0405: `getRegion()` resolves the region server-side (a cookie today,
// defaulting to "ID" until registration writes a real choice) and
// `RegionProvider` is the one Client Component boundary this file adds —
// it takes `children` as a prop and renders them straight through, so
// `AppShell` and every route below stay Server Components exactly as
// before. This makes every Phase U tab route dynamic (reading a cookie
// opts the segment out of static rendering), which is an accepted
// trade-off for an already-personalized, logged-in shell — see YT-0405's
// report for why this was scoped to the `(app)` group rather than the root
// layout, which also covers surfaces intended to stay statically
// generated and publicly indexable (docs/17-surfaces-and-roles.md §4.5).
//
// `NextIntlClientProvider` is the second, sibling Client Component boundary
// (docs/15-stack-locked.md line 28's locked next-intl choice, YT-0405's
// fourth acceptance criterion): `getLocale()`/`getMessages()` read from
// `i18n/request.ts`, which itself resolves the locale from the very same
// region cookie via `getRegionDisplayConfig()` — one source of truth for
// "which locale/region is active," never two competing ones. This makes
// `useTranslations()` available to any Client Component leaf the same way
// `useRegion()` already is, with only the active locale's message
// catalogues ever fetched (see that file's doc comment).
export default async function AppLayout({ children }: AppLayoutProps) {
  const region = await getRegion();
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <RegionProvider region={region}>
        <AppShell>{children}</AppShell>
      </RegionProvider>
    </NextIntlClientProvider>
  );
}
