import type { FeedItem } from "@yourtal/contracts/feed";

export interface LandingHeroProps {
  /** The AU feed's own top item (11.1.a: "a hero with real campaign video") — `null` when the feed had nothing to offer at build/revalidate time. */
  featured: FeedItem | null;
}

/**
 * The landing page's hero (11.1.a). A real, currently-live campaign's own
 * teaser clip — never a stock asset or a fabricated example — muted,
 * autoplaying and looping, the same convention the signed-out feed already
 * uses for its own teaser cards (`public-feed-teaser.tsx`). `null` is a
 * genuinely honest state (the API had nothing at build time, or is
 * unreachable — `getPublicFeed` never throws for either): the hero then
 * shows the same headline with no video track, rather than a broken
 * element or an invented placeholder.
 */
export function LandingHero({ featured }: LandingHeroProps) {
  return (
    <section className="relative flex min-h-[70vh] flex-col justify-end overflow-hidden bg-fg text-primary-fg">
      {featured ? (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-70"
          src={featured.teaserUrl}
          poster={featured.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      ) : null}
      <div className="relative z-10 flex flex-col gap-4 p-gutter-md pb-12 md:p-12">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-fg/80">YourTal</p>
        <h1 className="max-w-2xl font-display text-display md:text-display-lg">
          Watch, learn, earn — and spend it where you live.
        </h1>
        <p className="max-w-xl text-lg text-primary-fg/90">
          Real videos from real local businesses. Watch, answer a couple of honest questions, and
          earn points you spend at the businesses you already visit.
        </p>
        {featured ? (
          <p className="text-body-sm text-primary-fg/70">
            Now showing: {featured.title} — {featured.merchantName}
          </p>
        ) : null}
      </div>
    </section>
  );
}
