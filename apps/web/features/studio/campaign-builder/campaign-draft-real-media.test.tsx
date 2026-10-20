import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import { CampaignDraftList } from "./campaign-draft-list";
import {
  draftDurationSeconds,
  draftEstimatedDataMb,
  draftQuestionsAsked,
  type CampaignDraft,
} from "./campaign-draft";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { apiDraftToWebDraft } from "./campaign-draft-live-mapping";
import type { ApiCampaignDraft } from "./campaign-draft-live-response";
import { CampaignEntryPreview } from "./campaign-entry-preview";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000602";

/** What the API returns for a campaign with a ready video and no authored chapters, or one chapter. */
function apiDraft(overrides: Partial<ApiCampaignDraft>): ApiCampaignDraft {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    businessId: BUSINESS_ID,
    region: "AU",
    kind: "long_form",
    title: "Campaign",
    synopsis: "s",
    durationSeconds: 30,
    contentCategory: "food-and-drink",
    audience: "all_ages",
    lifecycleState: "live",
    rejectionReason: null,
    startsAt: "2026-10-20T00:00:00.000Z",
    endsAt: "2026-11-20T00:00:00.000Z",
    openViewing: false,
    teaserStartSeconds: 0,
    posterFrameSeconds: null,
    declaredInterests: [],
    chapters: [],
    captionsUrl: null,
    posterUrl: null,
    teaserUrl: null,
    hlsUrl: "https://media.test/hls/index.m3u8",
    rewardPoints: 3,
    questionCount: 0,
    scoringRule: "base_only",
    publishedAt: null,
    targetDistricts: [],
    rewardConfig: null,
    ...overrides,
  };
}

function wrap(ui: ReactElement) {
  return (
    <StudioIntlProvider>
      <RegionProvider region="AU">{ui}</RegionProvider>
    </StudioIntlProvider>
  );
}

describe("Studio duration, data cost and questions come from the real campaign (1.6.m)", () => {
  it("a live 30 second campaign with no chapters is 30 sec, ~3 MB and asks no questions", () => {
    const draft = apiDraftToWebDraft(apiDraft({}), "Kopi");
    expect(draftDurationSeconds(draft)).toBe(30);
    expect(draftEstimatedDataMb(draft)).toBe(3);
    expect(draftQuestionsAsked(draft)).toBe(0);
  });

  it("a 180 second video with one chapter is 180 s and one question, not 30 s from the chapter", () => {
    const draft = apiDraftToWebDraft(
      apiDraft({
        durationSeconds: 180,
        questionCount: 1,
        chapters: [{ title: "Full video", startSeconds: 0, rewardWeight: 1 }],
      }),
      "Kopi",
    );
    expect(draftDurationSeconds(draft)).toBe(180);
    expect(draftQuestionsAsked(draft)).toBe(1);
  });

  it("before a video is ready, the chapters being laid out still drive the length", () => {
    const draft = apiDraftToWebDraft(
      apiDraft({
        hlsUrl: null,
        durationSeconds: 60,
        chapters: [{ title: "Close", startSeconds: 570, rewardWeight: 1 }],
      }),
      "Kopi",
    );
    expect(draftDurationSeconds(draft)).toBe(600);
  });

  it("in mock mode (no server figures) it falls back to the chapters and the question formula", () => {
    const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi");
    expect(draftDurationSeconds(draft)).toBe(0);
    expect(draftQuestionsAsked({ ...draft, durationSeconds: null, questionsAsked: null })).toBe(0);
  });

  it("the list shows the real length, in seconds under a minute", () => {
    const thirty = apiDraftToWebDraft(apiDraft({ title: "Thirty" }), "Kopi");
    const sintel = apiDraftToWebDraft(
      apiDraft({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Sintel",
        durationSeconds: 180,
        chapters: [{ title: "Full video", startSeconds: 0, rewardWeight: 1 }],
      }),
      "Kopi",
    );
    render(
      wrap(
        <CampaignDraftList drafts={[thirty, sintel]} onOpen={vi.fn()} onCreate={vi.fn()} canEdit />,
      ),
    );
    expect(screen.getByText(/^30 sec · /)).toBeInTheDocument();
    expect(screen.getByText(/^3 min · /)).toBeInTheDocument();
    expect(screen.queryByText(/no video yet/)).not.toBeInTheDocument();
  });

  it("the preview card shows the real duration, data cost and question count", () => {
    const draft: CampaignDraft = apiDraftToWebDraft(
      apiDraft({ durationSeconds: 180, questionCount: 1, title: "Sintel" }),
      "Kopi",
    );
    render(wrap(<CampaignEntryPreview draft={draft} />));
    expect(screen.getByText("3 min")).toBeInTheDocument();
    expect(screen.getByText("~18 MB")).toBeInTheDocument();
    expect(screen.getByText("1 question")).toBeInTheDocument();
  });
});
