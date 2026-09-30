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
import { ViewerShell } from "@/features/shell/viewer-shell";
import { getNavTranslator } from "@/features/shell/nav-i18n";

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
 * doc comment) gives this surface the root layout only (fonts, `<html>`),
 * with zero calls to `cookies()` or `headers()` anywhere in the tree — see
 * this ticket's report for the build output confirming every route here
 * comes out static (`○`).
 *
 * Region is resolved from the `[locale]` route segment
 * (`apps/web/features/public/public-locale.ts`), never from the region
 * cookie `apps/web/features/region/get-region.ts` reads — that is the one
 * change this ticket's brief calls for to keep the surface static.
 *
 * **`dynamicParams = true` (11.2.a), not `false`.** This governs the
 * WHOLE subtree, not just this segment's own `locale` param: a descendant
 * page's `dynamicParams = true` (`c/[campaignId]/page.tsx`, for a real
 * campaign id `generateStaticParams` never enumerated) only takes effect
 * if every ancestor also allows it — Next's static-params gate is checked
 * against the full path, and one `false` anywhere above 404s the whole
 * combination at the router before ANY layout or page in the tree runs,
 * regardless of what the leaf itself declares. `requirePublicLocale`
 * below still 404s a `locale` outside `GENERATED_PUBLIC_LOCALES` — that
 * check just now happens inside this function instead of at the router,
 * which costs nothing real (a bad locale is not a path anything else here
 * ever links to).
 *
 * **F79 (11.1.d): the chrome is `ViewerShell`, in its signed-out mode, not
 * `PublicHeader`.** A logged-out visitor gets the same side rail/bottom
 * nav/top bar as a signed-in one — Home (`/${locale}`) and Store
 * (`/${locale}/rewards`) are real public destinations; Watch, Wallet and Me
 * have none, so their nav links go straight to `/login?returnTo=`, and the
 * top bar shows "Sign up to earn" instead of the points chip. This never
 * reads the session (no `cookies()`) — every href below is a plain string
 * computed from `locale`, so the page this renders stays exactly as
 * cacheable as before. `apps/web/proxy.ts` (Area A) is untouched: these
 * links do not un-gate `/wallet`/`/me`, they just send an anonymous visitor
 * straight to the sign-in prompt those routes would bounce them to anyway.
 * `PublicHeader` stays as a component (still used by `global-not-found.tsx`
 * and the lab gallery) — this is simply no longer where it is rendered.
 */
export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = true;

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
  const navT = getNavTranslator(config.intlLocale);

  return (
    <RootDocument lang={config.intlLocale}>
      <ViewerShell
        locale={config.intlLocale}
        // Never read for a signed-out caller (see `signedOut`'s own doc
        // comment on `ViewerShellProps`) — 0 rather than left undefined so
        // the prop stays required for every existing signed-in caller.
        availablePoints={0}
        signedOut={{
          homeHref: `/${locale}`,
          hrefs: {
            home: `/${locale}`,
            shorts: `/login?returnTo=${encodeURIComponent("/shorts")}`,
            store: `/${locale}/rewards`,
            wallet: `/login?returnTo=${encodeURIComponent("/wallet")}`,
            me: `/login?returnTo=${encodeURIComponent("/me")}`,
          },
          signUpHref: "/onboarding",
          signUpLabel: navT("signUpToEarn"),
        }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">{children}</div>
        <PublicFooter locale={config.intlLocale}>
          <PublicInfoLinks locale={config.intlLocale} basePath={`/${locale}`} />
        </PublicFooter>
      </ViewerShell>
    </RootDocument>
  );
}
