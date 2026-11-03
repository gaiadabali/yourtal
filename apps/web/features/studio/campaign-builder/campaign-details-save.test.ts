import { describe, expect, it } from "vitest";
import { detailsPatchFor, detailsSaveKey } from "./campaign-details-save";
import { liveDraft } from "./campaign-draft-live-fixtures";
import { apiDraftToWebDraft } from "./campaign-draft-live-mapping";
import { liveApiDraft } from "./campaign-draft-live-fixtures";

describe("detailsPatchFor", () => {
  it("carries the tags and districts, so Targeting saves with Details (B2)", () => {
    const draft = liveDraft();
    draft.targeting = { interests: ["coffee", "not-in-the-taxonomy"], districts: ["2150"] };
    expect(detailsPatchFor(draft)).toMatchObject({
      declaredInterests: ["coffee"],
      targetDistricts: ["2150"],
    });
  });

  it("sends no length: it is the server's, set when the video has been processed", () => {
    const draft = liveDraft();
    draft.chapters = [{ id: "c1", title: "Intro", startSeconds: 300 }];
    expect(detailsPatchFor(draft)).not.toHaveProperty("durationSeconds");
  });

  it("sends an empty synopsis as it is, and refuses a blank title", () => {
    expect(detailsPatchFor(liveDraft())?.synopsis).toBe("");
    expect(detailsPatchFor({ ...liveDraft(), title: "   " })).toBeNull();
  });

  it("changes its key when a tag or district changes, and not when nothing does", () => {
    const draft = liveDraft();
    const key = detailsSaveKey(draft);
    expect(detailsSaveKey({ ...draft })).toBe(key);
    expect(
      detailsSaveKey({ ...draft, targeting: { interests: ["coffee"], districts: [] } }),
    ).not.toBe(key);
    expect(
      detailsSaveKey({ ...draft, targeting: { interests: [], districts: ["2150"] } }),
    ).not.toBe(key);
  });
});

describe("a synopsis that is only the old hint (B8)", () => {
  it("reads as empty, in either language, so the editor shows the placeholder", () => {
    for (const hint of [
      "Add a synopsis before you submit for review.",
      "Tambahkan sinopsis sebelum Anda mengirim untuk ditinjau.",
    ]) {
      expect(apiDraftToWebDraft(liveApiDraft({ synopsis: hint }), "Snap App").synopsis).toBe("");
    }
  });

  it("leaves a real synopsis alone", () => {
    expect(
      apiDraftToWebDraft(liveApiDraft({ synopsis: "Two coffees for one." }), "Snap App").synopsis,
    ).toBe("Two coffees for one.");
  });
});
