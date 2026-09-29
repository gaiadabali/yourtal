import { describe, expect, it, vi } from "vitest";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: apiFetchMock }));

const campaign = mockCampaigns[0]!;
const terms = {
  campaignId: campaign.id,
  version: 1,
  rewardPoints: campaign.rewardPoints,
  questionCount: campaign.questionCount,
  scoringRule: campaign.scoringRule,
  durationSeconds: campaign.durationSeconds,
  accuracyBonusPoints: 0,
  effectiveFrom: campaign.publishedAt,
};

describe("getWatchCampaign", () => {
  it("reads the campaign and its current terms from the API", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/api/campaigns/${campaign.id}`)
        return Promise.resolve({ ok: true, data: campaign });
      if (path === `/api/campaigns/${campaign.id}/terms`)
        return Promise.resolve({ ok: true, data: terms });
      throw new Error(`unexpected path ${path}`);
    });
    const { getWatchCampaign } = await import("./get-watch-campaign");

    const result = await getWatchCampaign(campaign.id);

    expect(result).toEqual({ campaign, terms });
  });

  it("returns null when the campaign read fails (missing or not public)", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 404, code: "not_found", message: "No such campaign." },
    });
    const { getWatchCampaign } = await import("./get-watch-campaign");

    expect(await getWatchCampaign("unknown-id")).toBeNull();
  });

  it("returns null when the campaign exists but has no published terms", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/api/campaigns/${campaign.id}`)
        return Promise.resolve({ ok: true, data: campaign });
      return Promise.resolve({
        ok: false,
        error: { kind: "http", status: 404, code: "not_found", message: "No terms." },
      });
    });
    const { getWatchCampaign } = await import("./get-watch-campaign");

    expect(await getWatchCampaign(campaign.id)).toBeNull();
  });
});
