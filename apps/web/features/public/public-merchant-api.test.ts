import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicMerchantForLocale, getPublicMerchantFromApi } from "./public-merchant";

vi.mock("@/lib/api/public-api-fetch", () => ({ publicApiFetch: vi.fn() }));

/** A minimal FeedItem — only the fields this file's join logic reads. */
function feedItem(overrides: { campaignId: string; merchantName: string }) {
  return {
    campaignId: overrides.campaignId,
    businessId: "b1",
    merchantName: overrides.merchantName,
    title: "A campaign",
    synopsis: "s",
    posterUrl: "https://cdn.example.com/p.jpg",
    teaserUrl: "https://cdn.example.com/t.mp4",
    durationSeconds: 60,
    rewardPoints: 10,
    kind: "quick",
    questionCount: 0,
    maxRewardPoints: 10,
    estimatedDataMb: 5,
    contentCategory: "food-and-drink",
    audience: "all_ages",
    region: "AU",
    openViewing: true,
    endingSoon: false,
    why: "Popular right now",
    whyReason: "popular",
  };
}

function realCampaign(id: string, merchantName: string) {
  return { id, merchantName, title: "Real campaign" };
}

describe("getPublicMerchantFromApi (11.3.d)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds a merchant view from the anonymous feed's own matching items, deduplicated by campaign id", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    vi.mocked(publicApiFetch).mockImplementation((path: string) => {
      if (path === "/api/feed") {
        return Promise.resolve({
          ok: true,
          data: {
            items: [
              feedItem({ campaignId: "c1", merchantName: "Tasmania Wool Co." }),
              feedItem({ campaignId: "c2", merchantName: "Tasmania Wool Co." }),
              feedItem({ campaignId: "c3", merchantName: "Some Other Merchant" }),
            ],
          },
        });
      }
      if (path === "/api/campaigns/c1") {
        return Promise.resolve({ ok: true, data: realCampaign("c1", "Tasmania Wool Co.") });
      }
      if (path === "/api/campaigns/c2") {
        return Promise.resolve({ ok: true, data: realCampaign("c2", "Tasmania Wool Co.") });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    const merchant = await getPublicMerchantFromApi("tasmania-wool-co", "au");

    expect(merchant?.name).toBe("Tasmania Wool Co.");
    expect(merchant?.slug).toBe("tasmania-wool-co");
    expect(merchant?.campaigns.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    // No real listing->merchant join exists yet — never fabricated.
    expect(merchant?.listings).toEqual([]);
    expect(merchant?.district).toBeNull();
  });

  it("returns undefined when no feed item's merchant matches this slug", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    vi.mocked(publicApiFetch).mockResolvedValue({
      ok: true,
      data: { items: [feedItem({ campaignId: "c1", merchantName: "Someone Else" })] },
    });

    expect(await getPublicMerchantFromApi("nonexistent-merchant", "au")).toBeUndefined();
  });
});

describe("getPublicMerchantForLocale (11.3.d)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("never calls the API for a merchant already in the fixed mock catalogue", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    // Any AU mock merchant slug — proves the API fallback is skipped entirely.
    const merchant = await getPublicMerchantForLocale("wharf-espresso-co", "au");
    expect(merchant).toBeDefined();
    expect(publicApiFetch).not.toHaveBeenCalled();
  });
});
