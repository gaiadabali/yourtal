import { describe, expect, it } from "vitest";
import { listPublicCampaigns } from "./public-campaign-data";
import { listPublicListings } from "./public-listing-data";
import { listPublicMerchants } from "./public-merchant";
import { publicSitemapEntries } from "./public-sitemap-entries";

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
});
