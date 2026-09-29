import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { getPublicCampaignForLocale } from "./public-campaign-data";

vi.mock("@/lib/api/public-api-fetch", () => ({ publicApiFetch: vi.fn() }));

describe("getPublicCampaignForLocale (11.2.a)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the mock catalogue's own campaign without calling the API at all", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    const known = mockCampaigns[0];
    if (!known) throw new Error("mockCampaigns is empty");

    const campaign = await getPublicCampaignForLocale(known.id, "id");

    expect(campaign?.id).toBe(known.id);
    expect(publicApiFetch).not.toHaveBeenCalled();
  });

  it("falls back to GET /api/campaigns/:id for a real, seeded campaign the mock catalogue does not know", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    const realCampaign = { id: "11111111-1111-1111-1111-111111111111", title: "Real campaign" };
    vi.mocked(publicApiFetch).mockResolvedValue({ ok: true, data: realCampaign });

    const campaign = await getPublicCampaignForLocale(realCampaign.id, "au");

    expect(campaign).toEqual(realCampaign);
    expect(publicApiFetch).toHaveBeenCalledWith(
      `/api/campaigns/${realCampaign.id}`,
      expect.anything(),
      expect.objectContaining({ revalidate: expect.any(Number) }),
    );
  });

  it("returns undefined (so the page 404s) when neither the catalogue nor the API knows the id", async () => {
    const { publicApiFetch } = await import("@/lib/api/public-api-fetch");
    vi.mocked(publicApiFetch).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 404, code: "not_found", message: "no such campaign" },
    });

    const campaign = await getPublicCampaignForLocale("does-not-exist", "au");

    expect(campaign).toBeUndefined();
  });
});
