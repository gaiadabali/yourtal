import type { Metadata } from "next";
import { EmptyState } from "@yourtal/ui/empty-state";
import {
  GENERATED_PUBLIC_LOCALES,
  publicLanguageAlternates,
  publicLocaleConfig,
  publicUrl,
  requirePublicLocale,
} from "@/features/public/public-locale";
import { getPublicTranslator } from "@/features/public/public-i18n";
import { getPublicFeed } from "@/features/public/public-feed-data";
import { toPublicFeedTeaserItems } from "@/features/public/public-feed-view";
import { PublicFeedTeaser } from "@/features/public/public-feed-teaser";

export function generateStaticParams() {
  return GENERATED_PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

/**
 * 11.2.a: revalidate this page on a timer rather than per request — the
 * page stays statically generated (`generateStaticParams`/`dynamicParams`
 * above), but a build older than this many seconds gets a fresh copy from
 * `GET /api/feed` on the next visit instead of serving forever. Matches
 * `public-feed-data.ts`'s own `FEED_REVALIDATE_SECONDS`.
 */
export const revalidate = 60;

interface PublicHomePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PublicHomePageProps): Promise<Metadata> {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);
  return {
    title: `YourTal ${config.countryName}`,
    description: t("catalogue.description"),
    alternates: {
      canonical: publicUrl(locale, "/"),
      languages: publicLanguageAlternates("/"),
    },
  };
}

/**
 * `/[locale]` (11.1.b, 11.2.a) — a logged-out "For You" feed of Open
 * Viewing teasers, read from the API with ISR (`revalidate` above) rather
 * than the mock catalogues the rest of the public surface still reads
 * (`public-campaign-data.ts`). Still a Server Component with no
 * `cookies()`/`headers()` anywhere in its own body — only `PublicFeedTeaser`
 * (a small Client Component leaf) needs the browser for muted inline
 * playback and the scroll-snap interaction; see its own doc comment.
 *
 * `getPublicFeed` never throws and never returns an error a page could
 * fail the build over (see its own doc comment) — an empty result reads
 * exactly like "nothing live yet," which is the honest thing to show
 * either way.
 */
export default async function PublicHomePage({ params }: PublicHomePageProps) {
  const locale = requirePublicLocale((await params).locale);
  const config = publicLocaleConfig(locale);
  const t = getPublicTranslator(config.intlLocale);

  const feedItems = await getPublicFeed(locale);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-display font-bold text-fg">{t("feed.heading")}</h1>
      {feedItems.length === 0 ? (
        <EmptyState title={t("feed.emptyHeading")} description={t("feed.emptyBody")} />
      ) : (
        <div className="h-[calc(100dvh-8rem)] max-h-[900px] w-full overflow-hidden rounded-card border border-border-subtle lg:max-w-sm">
          <PublicFeedTeaser
            items={toPublicFeedTeaserItems(feedItems, locale, config)}
            landmarkLabel={t("feed.landmarkLabel")}
            endHeading={t("feed.endOfFeed")}
            playLabel={t("feed.playLabel")}
            pauseLabel={t("feed.pauseLabel")}
            signUpHref="/onboarding"
            signUpCta={t("feed.signUpCta")}
          />
        </div>
      )}
    </div>
  );
}
