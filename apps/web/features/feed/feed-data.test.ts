import { afterEach, describe, expect, it, vi } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { getShortsFeed } from "./feed-data";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  readSessionToken: vi.fn(),
  getAutoplaySetting: vi.fn(),
  getMeProfile: vi.fn(),
  earnedToday: vi.fn(),
}));

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/api/session-cookies", () => ({ readSessionToken: mocks.readSessionToken }));
vi.mock("@/features/me/me-data", () => ({
  getAutoplaySetting: mocks.getAutoplaySetting,
  getMeProfile: mocks.getMeProfile,
}));
vi.mock("@/features/wallet/wallet-data", () => ({ earnedToday: mocks.earnedToday }));

function item(campaignId: string, kind: "quick" | "long_form" = "quick") {
  return { campaignId, kind, title: campaignId, openViewing: true, rewardPoints: toPoints(5) };
}

const feed = (items: unknown[]) => ({ ok: true, data: { items } });
const httpError = (status: number, code: string) => ({
  ok: false,
  error: { kind: "http", status, code, message: code },
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("getShortsFeed: signed out (5.6.c)", () => {
  it("reads only the anonymous feed, naming the region, and flags the data signed out", async () => {
    mocks.readSessionToken.mockResolvedValue(null);
    mocks.apiFetch.mockResolvedValue(feed([item("a"), item("b", "long_form"), item("c")]));

    const result = await getShortsFeed("ID");

    // One call, with the region the API demands of an anonymous feed; nothing that needs a session.
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch.mock.calls[0]?.[0]).toBe("/api/feed?surface=home&kind=quick&region=ID");
    expect(mocks.getMeProfile).not.toHaveBeenCalled();
    expect(mocks.getAutoplaySetting).not.toHaveBeenCalled();
    expect(mocks.earnedToday).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      data: { signedOut: true, savedIds: [], earnedToday: 0, ageBand: "adult" },
    });
    if (result.ok) expect(result.data.items.map((i) => i.campaignId)).toEqual(["a", "c"]);
  });

  it("is ok with no items when Open Viewing has no Shorts in the region (the empty state, not the error)", async () => {
    mocks.readSessionToken.mockResolvedValue(null);
    mocks.apiFetch.mockResolvedValue(feed([]));
    expect(await getShortsFeed("AU")).toMatchObject({
      ok: true,
      data: { signedOut: true, items: [] },
    });
  });

  it("is not ok only when the feed itself could not be read", async () => {
    mocks.readSessionToken.mockResolvedValue(null);
    mocks.apiFetch.mockResolvedValue(httpError(503, "unavailable"));
    expect(await getShortsFeed("AU")).toEqual({ ok: false });
  });
});

describe("getShortsFeed: signed in", () => {
  it("reads the viewer's own feed without a region, with their saves and points", async () => {
    mocks.readSessionToken.mockResolvedValue("token");
    mocks.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/api/feed")
          ? feed([item("a")])
          : { ok: true, data: { campaignIds: ["11111111-1111-4111-8111-111111111111"] } },
      ),
    );
    mocks.getAutoplaySetting.mockResolvedValue({ ok: true, data: { autoplay: "never" } });
    mocks.getMeProfile.mockResolvedValue({ ok: true, data: { profile: { ageBand: "teen" } } });
    mocks.earnedToday.mockResolvedValue(25);

    const result = await getShortsFeed("AU");

    expect(mocks.apiFetch.mock.calls.map((call) => String(call[0]))).toContain(
      "/api/feed?surface=home&kind=quick",
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        signedOut: false,
        savedIds: ["11111111-1111-4111-8111-111111111111"],
        earnedToday: 25,
        autoplay: "never",
        ageBand: "teen",
      },
    });
  });

  it("falls back to the visitor's feed when the API no longer accepts the session", async () => {
    mocks.readSessionToken.mockResolvedValue("expired");
    mocks.apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("region=AU") ? feed([item("a")]) : httpError(401, "session_invalid"),
      ),
    );
    mocks.getAutoplaySetting.mockResolvedValue({ ok: false });
    mocks.getMeProfile.mockResolvedValue({ ok: false });
    mocks.earnedToday.mockResolvedValue(0);

    expect(await getShortsFeed("AU")).toMatchObject({ ok: true, data: { signedOut: true } });
  });

  it("keeps a real failure an error", async () => {
    mocks.readSessionToken.mockResolvedValue("token");
    mocks.apiFetch.mockResolvedValue(httpError(500, "boom"));
    mocks.getAutoplaySetting.mockResolvedValue({ ok: false });
    mocks.getMeProfile.mockResolvedValue({ ok: false });
    mocks.earnedToday.mockResolvedValue(0);
    expect(await getShortsFeed("AU")).toEqual({ ok: false });
  });
});
