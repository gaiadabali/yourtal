import { describe, expect, it } from "vitest";
import { createCampaignDraftSchema } from "./create-campaign-draft.schema";
import { updateCampaignDraftSchema } from "./update-campaign-draft.schema";

const NEW_DRAFT = {
  kind: "long_form",
  title: "Untitled campaign",
  synopsis: "",
  durationSeconds: 60,
  contentCategory: "entertainment",
  audience: "all_ages",
  startsAt: "2026-10-20T00:00:00.000Z",
  endsAt: "2026-11-20T00:00:00.000Z",
};

describe("a draft may have no synopsis yet (B8: the hint is a placeholder, not saved text)", () => {
  it("creates a draft with an empty synopsis", () => {
    expect(createCampaignDraftSchema.safeParse(NEW_DRAFT).success).toBe(true);
  });

  it("lets a patch empty the synopsis again", () => {
    expect(updateCampaignDraftSchema.safeParse({ synopsis: "" }).success).toBe(true);
  });

  it("still refuses a synopsis over 500 characters, and an empty title", () => {
    expect(
      createCampaignDraftSchema.safeParse({ ...NEW_DRAFT, synopsis: "x".repeat(501) }).success,
    ).toBe(false);
    expect(updateCampaignDraftSchema.safeParse({ title: "" }).success).toBe(false);
  });
});
