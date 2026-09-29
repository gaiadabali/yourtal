import type { Metadata } from "next";
import { getPublicFeed } from "@/features/public/public-feed-data";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { PublicFooter } from "@/features/public/public-footer";
import { LandingHero } from "@/features/landing/landing-hero";
import { LandingRegionChooser } from "@/features/landing/landing-region-chooser";
import { LandingHowItWorks } from "@/features/landing/landing-how-it-works";
import { LandingForBusiness } from "@/features/landing/landing-for-business";

/**
 * `/` — the public landing page (TASKS.md 11.1.a). Signed-in visitors never
 * reach this: `route-redirects.ts`'s `/` rule sends them to `/home` at the
 * edge, before this page ever renders; the redirect check itself lives
 * there, not here, so this page stays free of `cookies()`/`headers()` and
 * comes out static/ISR like the rest of the public surface
 * (`(public)/[locale]/layout.tsx`'s own header explains why that matters).
 *
 * `revalidate` (not fully static): the hero's featured video is a REAL,
 * currently live campaign (`getPublicFeed`), so this page needs to notice
 * when that changes — same cadence `public-feed-data.ts` itself uses.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "YourTal — Watch, learn, earn",
  description:
    "Watch real videos from local businesses, answer a couple of honest questions, and earn points to spend where you live.",
  alternates: {
    canonical: `${PUBLIC_SITE_URL}/`,
    languages: {
      "en-AU": `${PUBLIC_SITE_URL}/au`,
      "id-ID": `${PUBLIC_SITE_URL}/id`,
      // 11.1.a: crawlable chooser, no IP redirect — this bare `/` page IS
      // the neutral default a crawler should try first.
      "x-default": `${PUBLIC_SITE_URL}/`,
    },
  },
};

export default async function LandingPage() {
  const feed = await getPublicFeed("au");
  const featured = feed[0] ?? null;

  return (
    <main className="flex flex-col">
      <LandingHero featured={featured} />
      <LandingRegionChooser />
      <LandingHowItWorks />
      <LandingForBusiness />
      <PublicFooter locale="en-AU" />
    </main>
  );
}
