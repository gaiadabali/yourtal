import { describe, expect, it } from "vitest";
import { buildCampaignBoardQuery, parseCampaignBoardParams } from "./campaign-board-params";

describe("parseCampaignBoardParams", () => {
  it("defaults to value sort and the all-kinds filter when no params are given", () => {
    expect(parseCampaignBoardParams({})).toEqual({ sort: "value", kind: "all" });
  });

  it("parses valid explicit values", () => {
    expect(parseCampaignBoardParams({ sort: "reward", kind: "quick" })).toEqual({ sort: "reward", kind: "quick" });
  });

  it("falls back to the default for an invalid sort value rather than throwing", () => {
    expect(parseCampaignBoardParams({ sort: "popularity" })).toEqual({ sort: "value", kind: "all" });
  });

  it("falls back to the default for an invalid kind value rather than throwing", () => {
    expect(parseCampaignBoardParams({ kind: "short_form" })).toEqual({ sort: "value", kind: "all" });
  });

  it("takes the first value when Next hands back a repeated query param as an array", () => {
    expect(parseCampaignBoardParams({ sort: ["reward", "duration"] })).toEqual({ sort: "reward", kind: "all" });
  });
});

describe("buildCampaignBoardQuery", () => {
  it("omits both params when both are at their default", () => {
    expect(buildCampaignBoardQuery({ sort: "value", kind: "all" }, {})).toBe("");
  });

  it("preserves the untouched field when updating the other", () => {
    const query = buildCampaignBoardQuery({ sort: "value", kind: "quick" }, { sort: "reward" });
    expect(query).toContain("sort=reward");
    expect(query).toContain("kind=quick");
  });

  it("drops a field from the query once it is reset back to its default", () => {
    const query = buildCampaignBoardQuery({ sort: "reward", kind: "all" }, { sort: "value" });
    expect(query).toBe("");
  });
});
