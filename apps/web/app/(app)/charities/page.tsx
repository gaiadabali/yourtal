import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { AuctionPageShell } from "@/features/auction/auction-page-shell";
import { CharityLogo } from "@/features/charity/charity-logo";
import { listCharitiesOrNull } from "@/features/charity/charity-data";
import { getRegion } from "@/features/region/get-region";

/** 13.21.b: the approved charities in the viewer's region (moved into the viewer shell from `(charity)`). */
export default async function CharitiesPage() {
  const [t, charities, region] = await Promise.all([
    getTranslations("charity"),
    listCharitiesOrNull(),
    getRegion(),
  ]);
  return (
    <AuctionPageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-headline font-bold text-fg">{t("list.title")}</h1>
          <p className="text-body font-sans text-fg-muted">{t(`browse.intro.${region}`)}</p>
        </div>
        <a
          href="/auctions"
          className="text-label font-sans font-semibold text-accent hover:underline"
        >
          {t("browse.auctionsLink")}
        </a>
      </div>
      {charities === null ? (
        <ErrorState title={t("browse.error.title")} description={t("browse.error.body")} />
      ) : charities.length === 0 ? (
        <EmptyState title={t("browse.empty.title")} description={t("browse.empty.body")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {charities.map((charity) => (
            <li key={charity.id}>
              <article className="relative flex h-full flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5 transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3">
                  <CharityLogo charity={charity} />
                  <div className="min-w-0">
                    <h2 className="text-body font-sans font-semibold text-fg">
                      <a
                        href={`/charities/${charity.id}`}
                        className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {charity.name}
                      </a>
                    </h2>
                    <p className="text-caption font-sans text-fg-muted">
                      {t(`cause.${charity.cause}`)} · {t(`browse.region.${charity.region}`)}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-3 text-body-sm font-sans text-fg-muted">
                  {charity.summary}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
      <a href="/charity/apply" className="w-fit text-body-sm font-sans text-accent underline">
        {t("list.applyLink")}
      </a>
    </AuctionPageShell>
  );
}
