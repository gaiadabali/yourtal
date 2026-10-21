import { getTranslations } from "next-intl/server";
import { Button } from "@yourtal/ui/button";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { getShortsFeed } from "@/features/feed/feed-data";
import { ShortsFeed } from "@/features/feed/shorts-feed";
import { SHORTS_SIGN_UP_HREF } from "@/features/feed/shorts-signup-href";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { getRegion } from "@/features/region/get-region";
import { getDisplayLocale } from "@/i18n/get-locale";

/**
 * Shorts (13.14.a): the vertical swipe feed, Shorts only, earning in place
 * (F15). Long videos live on Home. The region comes from the signed-in
 * account on the server, never from this page.
 *
 * Signed out (5.6.c, F8, F79) it is the Open Viewing Shorts, which play for
 * anyone and earn for no one, with "Sign up to earn" where earning would be.
 * No Shorts in the region is the empty state with that prompt, never the error
 * state: that is for a feed that could not be read.
 */
export default async function ShortsPage() {
  const [region, locale, t] = await Promise.all([
    getRegion(),
    getDisplayLocale(),
    getTranslations("feed"),
  ]);
  const result = await getShortsFeed(region);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="sr-only">{t("shortsTitle")}</h1>
      {!result.ok ? (
        <ErrorState
          title={t("error.heading")}
          description={t("error.body")}
          retry={
            <a href="/shorts" className="text-label font-sans font-semibold text-accent">
              {t("error.retry")}
            </a>
          }
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          headingLevel={2}
          title={t("shortsEmpty.heading")}
          description={result.data.signedOut ? t("shortsEmpty.visitorBody") : t("shortsEmpty.body")}
          action={
            result.data.signedOut ? (
              <Button asChild size="lg">
                <a href={SHORTS_SIGN_UP_HREF}>{t("item.signUpToEarn")}</a>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ShortsFeed
          data={result.data}
          locale={locale}
          publicBase={`${PUBLIC_SITE_URL}/${region === "AU" ? "au" : "id"}`}
        />
      )}
    </div>
  );
}
