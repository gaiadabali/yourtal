import { describe, expect, it } from "vitest";
import { listPublicCampaigns } from "./public-campaign-data";
import { listPublicListings } from "./public-listing-data";
import { listPublicMerchants } from "./public-merchant";
import { publicSitemapEntries } from "./public-sitemap-entries";
import { PUBLIC_INFO_SLUGS } from "./public-info-pages";

describe("publicSitemapEntries", () => {
  it("includes both generated locales' home and catalogue hub, with language alternates", () => {
    const entries = publicSitemapEntries();
    const home = entries.filter(
      (entry) => entry.url.endsWith(".com/id/") || entry.url.endsWith(".com/au/"),
    );
    expect(home).toHaveLength(2);
    for (const entry of home) {
      expect(entry.alternates?.languages).toEqual({
        "id-ID": "https://yourtal.com/id/",
        "en-AU": "https://yourtal.com/au/",
      });
    }
  });

  /**
   * YT-0181's last criterion: *"Country content genuinely separated — no
   * cross-region offers leak into a sitemap."*
   *
   * The generator builds per locale from locale-scoped readers, so a leak
   * cannot come from the loop — it would have to come from the catalogues
   * themselves overlapping. That is the thing worth asserting, and it is
   * the thing no existing test covered: the other cases here check that
   * each locale's entries match *its own* catalogue, which stays true even
   * if both catalogues returned the same entities.
   *
   * A shared id would mean `/au/c/{id}` and `/id/c/{id}` both resolve, so
   * one campaign would be indexed twice under two languages — duplicate
   * content to a crawler, and a viewer sent to the wrong region's page.
   * `public-locale.ts` records that AU and ID read independently-seeded
   * catalogues precisely so that this cannot happen; this is the check that
   * would notice if that ever stopped being true.
   */
  it("shares no entity between the two locales, so no region's page can be indexed under the other", () => {
    const idsFor = (locale: "id" | "au") => ({
      campaigns: new Set(listPublicCampaigns(locale).map((campaign) => campaign.id)),
      listings: new Set(listPublicListings(locale).map((listing) => listing.id)),
      merchants: new Set(listPublicMerchants(locale).map((merchant) => merchant.slug)),
    });
    const id = idsFor("id");
    const au = idsFor("au");

    expect([...id.campaigns].filter((value) => au.campaigns.has(value))).toEqual([]);
    expect([...id.listings].filter((value) => au.listings.has(value))).toEqual([]);
    expect([...id.merchants].filter((value) => au.merchants.has(value))).toEqual([]);

    // And both catalogues are non-empty, so the disjointness above is a
    // real separation rather than one side simply having nothing in it.
    expect(id.campaigns.size).toBeGreaterThan(0);
    expect(au.campaigns.size).toBeGreaterThan(0);
  });

  it("emits every URL under exactly one locale prefix", () => {
    // The other direction: even with disjoint catalogues, a generator bug
    // could emit an entity's URL under both prefixes. Comparing the path
    // after the locale segment catches that without re-deriving what the
    // catalogues hold.
    const paths = publicSitemapEntries().map((entry) =>
      new URL(entry.url).pathname.replace(/^\/(id|au)/, ""),
    );
    const seen = new Map<string, number>();
    for (const path of paths) seen.set(path, (seen.get(path) ?? 0) + 1);

    // `/`, `/rewards` and the info pages are the genuine per-locale pairs:
    // the only pages in both regions, so the only ones with hreflang alternates.
    const paired = new Set(["/", "/rewards", ...PUBLIC_INFO_SLUGS.map((slug) => `/${slug}`)]);
    const duplicated = [...seen].filter(([path, count]) => count > 1 && !paired.has(path));
    expect(duplicated).toEqual([]);
  });

  it("never emits a /watch URL — Open Viewing is reached by click-through, not a sitemap destination", () => {
    const entries = publicSitemapEntries();
    expect(entries.some((entry) => entry.url.includes("/watch"))).toBe(false);
  });

  it("one entry per campaign in each locale's catalogue, no more, no fewer", () => {
    const entries = publicSitemapEntries();
    for (const locale of ["id", "au"] as const) {
      const campaigns = listPublicCampaigns(locale);
      const campaignEntries = entries.filter((entry) =>
        entry.url.startsWith(`https://yourtal.com/${locale}/c/`),
      );
      expect(campaignEntries).toHaveLength(campaigns.length);
    }
  });

  it("one entry per listing and per merchant in each locale, matching the catalogue exactly", () => {
    const entries = publicSitemapEntries();
    for (const locale of ["id", "au"] as const) {
      const listingEntries = entries.filter((entry) =>
        entry.url.startsWith(`https://yourtal.com/${locale}/rewards/`),
      );
      expect(listingEntries).toHaveLength(listPublicListings(locale).length);

      const merchantEntries = entries.filter((entry) =>
        entry.url.startsWith(`https://yourtal.com/${locale}/m/`),
      );
      expect(merchantEntries).toHaveLength(listPublicMerchants(locale).length);
    }
  });

  it("a campaign entry's lastModified is the campaign's genuine publishedAt, not a fabricated date", () => {
    const entries = publicSitemapEntries();
    const [firstCampaign] = listPublicCampaigns("id");
    expect(firstCampaign).toBeDefined();
    if (firstCampaign) {
      const entry = entries.find(
        (candidate) => candidate.url === `https://yourtal.com/id/c/${firstCampaign.id}`,
      );
      expect(entry?.lastModified).toBe(firstCampaign.publishedAt);
    }
  });

  it("lists every info page in both regions, with language alternates", () => {
    const urls = new Map(publicSitemapEntries().map((entry) => [entry.url, entry]));
    for (const slug of PUBLIC_INFO_SLUGS) {
      for (const locale of ["au", "id"]) {
        const entry = urls.get(`https://yourtal.com/${locale}/${slug}`);
        expect(entry?.alternates?.languages, `${locale}/${slug}`).toEqual({
          "id-ID": `https://yourtal.com/id/${slug}`,
          "en-AU": `https://yourtal.com/au/${slug}`,
        });
      }
    }
  });
});
