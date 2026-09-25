import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootDocument, baseMetadata, baseViewport } from "@/app/root-document";
import {
  GENERATED_PUBLIC_LOCALES,
  PUBLIC_SITE_URL,
  publicLocaleConfig,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { PublicFooter } from "@/features/public/public-footer";
import { PublicInfoLinks } from "@/features/public/public-info-links";
import { PublicHeader } from "@/features/public/public-header";

/**
 * The public surface's own layout (YT-0431) — deliberately a SIBLING route
 * group to `(app)`/`(merchant)`, on the same principle both already
 * establish: `app/(app)/layout.tsx` unconditionally wraps every route
 * beneath it in the five-tab `AppShell` and calls `getRegion()`, which reads
 * a cookie via `next/headers` and forces the whole subtree to render
 * dynamically. `docs/11-seo-aeo-geo.md` §1 requires the campaign, merchant,
 * offer and catalogue pages to be **statically generated and indexable**, so
 * nesting them under `(app)` — even if that layout allowed an opt-out,
 * which it does not — would be the wrong shell for an anonymous, SEO-facing
 * visitor. `(app)/layout.tsx` and `(app)/loading.tsx` are also off limits
 * for this ticket. A sibling `(public)` group (mirroring the merchant
 * portal's own `(merchant)` group, see `app/(merchant)/merchant/page.tsx`'s
 * doc comment) gives this surface the root layout only (fonts, `<html>`)
 * plus this file's own minimal chrome, with zero calls to `cookies()` or
 * `headers()` anywhere in the tree — see this ticket's report for the build
 * output confirming every route here comes out static (`○`).
 *
 * Region is resolved from the `[locale]` route segment
 * (`apps/web/features/public/public-locale.ts`), never from the region
 * cookie `apps/web/features/region/get-region.ts` reads — that is the one
 * change this ticket's brief calls for to keep the surface static.
 *
 * `generateStaticParams`/`dynamicParams = false` together mean a locale
 * outside `GENERATED_PUBLIC_LOCALES` (today, just `"id"` — see
 * `public-locale.ts` for why `"au"` is not generated yet) 404s at the router
 * before this layout, or anything under it, ever runs.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export const metadata: Metadata = {
  ...baseMetadata,
  metadataBase: new URL(PUBLIC_SITE_URL),
};

export const viewport = baseViewport;

export interface PublicLocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function PublicLocaleLayout({ children, params }: PublicLocaleLayoutProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);

  return (
    <RootDocument lang={config.intlLocale}>
      <div className="flex min-h-dvh flex-col bg-surface">
        <PublicHeader locale={config.intlLocale} homeHref={`/${locale}`} />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">{children}</main>
        <PublicFooter locale={config.intlLocale}>
          <PublicInfoLinks locale={config.intlLocale} basePath={`/${locale}`} />
        </PublicFooter>
      </div>
    </RootDocument>
  );
}
