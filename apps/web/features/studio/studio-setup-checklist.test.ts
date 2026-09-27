import { describe, expect, it } from "vitest";
import { buildSetupChecklist, isSetupComplete } from "./studio-setup-checklist";

const NONE_DONE = {
  channelSet: false,
  pointsBought: false,
  campaignUploaded: false,
  questionsWritten: false,
  campaignSubmitted: false,
};

describe("buildSetupChecklist", () => {
  it("returns all five steps in a fixed order, each marked done or not", () => {
    const steps = buildSetupChecklist({ ...NONE_DONE, pointsBought: true });
    expect(steps.map((step) => step.id)).toEqual([
      "channelSet",
      "pointsBought",
      "campaignUploaded",
      "questionsWritten",
      "campaignSubmitted",
    ]);
    expect(steps.find((step) => step.id === "pointsBought")?.done).toBe(true);
    expect(steps.find((step) => step.id === "channelSet")?.done).toBe(false);
  });
});

describe("isSetupComplete", () => {
  it("is false until every step is done", () => {
    expect(isSetupComplete(NONE_DONE)).toBe(false);
    expect(
      isSetupComplete({
        channelSet: true,
        pointsBought: true,
        campaignUploaded: true,
        questionsWritten: true,
        campaignSubmitted: true,
      }),
    ).toBe(true);
  });
});
