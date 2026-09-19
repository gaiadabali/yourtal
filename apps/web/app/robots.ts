import type { MetadataRoute } from "next";
import { GENERATED_PUBLIC_LOCALES, PUBLIC_SITE_URL } from "@/features/public/public-locale";

/**
 * `/robots.txt` (YT-0180). Root of `app/`, same requirement as
 * `sitemap.ts` — see that file's header.
 *
 * **Allowlist, not a denylist of app routes.** The indexable surface is
 * exactly `/[locale]/**` for each locale in `GENERATED_PUBLIC_LOCALES` —
 * everything else (`/business`, `/campaign`, `/me`, `/onboarding`,
 * `/quick`, `/store`, `/wallet`, `/watch`, `/merchant`, all under
 * `app/(app)/**`/`app/(merchant)/**`) is a signed-in or device-provisioned
 * surface that was never meant to be crawled. Hand-listing those private
 * prefixes here would need updating every time one is added, and a missed
 * update silently exposes a new private route to search engines. Denying
 * `/` and allowing only the generated locale prefixes fails safe instead:
 * a future private route needs no robots.ts change to stay out of the
 * index, and a future public locale is allowed here only once it is
 * actually generated (`GENERATED_PUBLIC_LOCALES`), not merely a typed
 * `PublicLocale` value (`public-locale.ts`'s own history with `"au"` is
 * exactly the case this guards against).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: GENERATED_PUBLIC_LOCALES.map((locale) => `/${locale}`),
      disallow: "/",
    },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
