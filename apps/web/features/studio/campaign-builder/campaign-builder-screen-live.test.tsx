import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAreas from "@/messages/en-AU/areas.json";
import enStudio from "@/messages/en-AU/studio.json";
import enTaxonomy from "@/messages/en-AU/taxonomy.json";
import { RegionProvider } from "@/features/region/region-context";
import {
  createCampaignDraftLive,
  submitCampaignDraftLive,
  updateCampaignDraftDetailsLive,
} from "./campaign-builder-actions";
import type { CampaignDraft, CampaignVideoUpload } from "./campaign-draft";
import { liveAllocation, liveDraft, LIVE_BUSINESS_ID } from "./campaign-draft-live-fixtures";
import { CampaignBuilderScreen } from "./campaign-builder-screen";
import type * as QuestionLiveActions from "../question-bank/question-live-actions";
import { uploadCampaignVideo } from "./media-upload-client";
import type { UploadCampaignVideoParams } from "./media-upload-client";

vi.mock("./campaign-builder-actions", () => ({
  createCampaignDraftLive: vi.fn(),
  updateCampaignDraftDetailsLive: vi.fn(),
  setRewardConfigLive: vi.fn(),
  submitCampaignDraftLive: vi.fn(),
}));
vi.mock("./media-upload-client", () => ({ uploadCampaignVideo: vi.fn() }));
vi.mock("../question-bank/question-live-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof QuestionLiveActions>()),
  listQuestionsLive: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));
vi.mock("@/features/areas/area-actions", () => ({
  fetchAreaStatesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { region: "AU", states: [{ code: "NSW", name: "New South Wales", placeCount: 2 }] },
  }),
  fetchAreaPlacesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      region: "AU",
      state: { code: "NSW", name: "New South Wales" },
      places: [
        { name: "Bondi", postcode: "2026" },
        { name: "Pyrmont", postcode: "2009" },
      ],
    },
  }),
  fetchAreaSummariesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { region: "AU", areas: [] },
  }),
}));

const update = vi.mocked(updateCampaignDraftDetailsLive);
const create = vi.mocked(createCampaignDraftLive);
const submit = vi.mocked(submitCampaignDraftLive);

/** A draft the author has already given a title: the list shows it as a button with that name. */
const TITLE = "Two for one";

function renderLive(drafts: CampaignDraft[]) {
  return render(
    <NextIntlClientProvider
      locale="en-AU"
      messages={{ studio: enStudio, areas: enAreas, taxonomy: enTaxonomy }}
    >
      <RegionProvider region="AU">
        <CampaignBuilderScreen
          businessId={LIVE_BUSINESS_ID}
          merchantName="Snap App"
          initialDrafts={drafts}
          canEdit
          isVerified
          isLiveMode
          allocations={[liveAllocation()]}
        />
      </RegionProvider>
    </NextIntlClientProvider>,
  );
}

async function openFirstDraft() {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(TITLE) }));
  // The editor is loaded on open (next/dynamic), so wait for it.
  return screen.findByRole("textbox", { name: "Campaign title" }, { timeout: 10_000 });
}

/** What the API hands back from a PATCH: the draft as saved. */
function savedAs(overrides: Parameters<typeof liveDraft>[0] = {}) {
  return { ok: true as const, value: liveDraft({ title: TITLE, ...overrides }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(savedAs());
});

describe("Targeting saves (B2)", () => {
  it("saves a picked tag and a removed district by itself, and says so", async () => {
    const user = userEvent.setup();
    renderLive([liveDraft({ title: TITLE, targetDistricts: ["2026"] })]);
    await openFirstDraft();

    await user.click(screen.getByRole("tab", { name: "Targeting" }));
    await user.click(await screen.findByRole("button", { name: "Coffee" }));
    await user.click(await screen.findByRole("button", { name: /Remove 2026/ }));

    // No Back button, no tab change: the timer saves it.
    await waitFor(
      () =>
        expect(update).toHaveBeenCalledWith(
          LIVE_BUSINESS_ID,
          expect.any(String),
          "Snap App",
          expect.objectContaining({ declaredInterests: ["coffee"], targetDistricts: [] }),
        ),
      { timeout: 4_000 },
    );
    expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
  });
});

describe("Details save (B8)", () => {
  it("saves what was typed the moment the author leaves the tab, not a second later", async () => {
    const user = userEvent.setup();
    renderLive([liveDraft({ title: TITLE })]);
    const title = await openFirstDraft();

    await user.clear(title);
    await user.type(title, "Coffee week");
    await user.type(screen.getByRole("textbox", { name: "Synopsis" }), "Two coffees for one.");
    await user.click(screen.getByRole("tab", { name: "Reward" }));

    // The timer is a full second; this must not wait for it.
    await waitFor(
      () =>
        expect(update).toHaveBeenCalledWith(
          LIVE_BUSINESS_ID,
          expect.any(String),
          "Snap App",
          expect.objectContaining({ title: "Coffee week", synopsis: "Two coffees for one." }),
        ),
      { timeout: 500 },
    );

    // And it is still there when they come back.
    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByRole("textbox", { name: "Campaign title" })).toHaveValue("Coffee week");
  });

  it("shows unsaved, then saved, and a Save button that saves at once", async () => {
    const user = userEvent.setup();
    renderLive([liveDraft({ title: TITLE })]);
    const title = await openFirstDraft();
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.type(title, "!");
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 500 });
    expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
  });

  it("says when it could not save, and does not claim it did", async () => {
    update.mockResolvedValue({ ok: false, message: "The service is busy." });
    const user = userEvent.setup();
    renderLive([liveDraft({ title: TITLE })]);
    const title = await openFirstDraft();

    await user.type(title, "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    expect(screen.queryByText("All changes saved.")).not.toBeInTheDocument();
  });

  it("does not send an empty title, and says why", async () => {
    const user = userEvent.setup();
    renderLive([liveDraft({ title: TITLE })]);
    const title = await openFirstDraft();

    await user.clear(title);
    await user.click(screen.getByRole("tab", { name: "Reward" }));
    await user.click(screen.getByRole("tab", { name: "Details" }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toContain(
      "Give the campaign a title to save your changes.",
    );
  });

  it("creates a new draft with an empty synopsis, so the hint stays a placeholder", async () => {
    create.mockResolvedValue({ ok: true, value: liveDraft() });
    renderLive([]);

    await userEvent.click(screen.getByRole("button", { name: "New campaign" }));
    const synopsis = await screen.findByRole("textbox", { name: "Synopsis" }, { timeout: 10_000 });

    expect(create).toHaveBeenCalledWith(
      LIVE_BUSINESS_ID,
      "Snap App",
      expect.objectContaining({ synopsis: "" }),
    );
    expect(synopsis).toHaveValue("");
    expect(synopsis).toHaveAttribute("placeholder", "Add a synopsis before you submit for review.");
    expect(screen.getByText(/500 characters left/)).toBeInTheDocument();
  });

  // The upload's poller reports long after the tab it started on is gone; it used to write
  // back the draft as it was when the upload began, undoing every edit since.
  it("keeps what was typed when the video's progress arrives later", async () => {
    const user = userEvent.setup();
    let report: UploadCampaignVideoParams["onUpdate"] | null = null;
    vi.mocked(uploadCampaignVideo).mockImplementation((params) => {
      report = params.onUpdate;
      return Promise.resolve();
    });
    renderLive([liveDraft({ title: TITLE })]);
    await openFirstDraft();

    await user.click(screen.getByRole("tab", { name: "Video & chapters" }));
    await user.upload(
      screen.getByLabelText("Video file"),
      new File(["x"], "promo.mp4", { type: "video/mp4" }),
    );
    expect(report).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "Details" }));
    const title = screen.getByRole("textbox", { name: "Campaign title" });
    await user.clear(title);
    await user.type(title, "Edited while uploading");

    const later: CampaignVideoUpload = {
      fileName: "promo.mp4",
      status: "processing",
      progressPercent: 100,
    };
    act(() => report?.(later));
    act(() => report?.({ ...later, status: "ready" }));

    expect(screen.getByRole("textbox", { name: "Campaign title" })).toHaveValue(
      "Edited while uploading",
    );
    expect(screen.getByRole("heading", { name: "Edited while uploading" })).toBeInTheDocument();
    // And the video did move on.
    await user.click(screen.getByRole("tab", { name: "Video & chapters" }));
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

/** A draft with everything review needs, for a 20-second video (no questions asked). */
function submittable() {
  return liveDraft({
    title: TITLE,
    synopsis: "Two coffees for one, all week.",
    durationSeconds: 20,
    hlsUrl: "https://media.test/index.m3u8",
    rewardPoints: 2,
    rewardConfig: {
      allocationId: "alloc_biz:purchase-1",
      rewardPointsPerCompletion: 2,
      accuracyBonusPoints: 0,
      maxPointsForCampaign: 100,
      dailyCapPoints: null,
    },
  });
}

describe("Submit for review (B6, B7)", () => {
  it("says what is missing, before the author presses anything, and keeps Submit off", async () => {
    renderLive([liveDraft({ title: TITLE })]);
    await openFirstDraft();

    const list = screen.getByText("Before you submit, this campaign needs:").parentElement!;
    const items = within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "A synopsis (Details tab).",
      "A video (Video & chapters tab).",
      "A saved reward (Reward tab).",
      "At least 3 questions; you have 0 (Questions tab).",
    ]);
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("names a video that is still processing, not a missing one", async () => {
    renderLive([
      {
        ...submittable(),
        video: { fileName: "a.mp4", status: "processing", progressPercent: 100 },
      },
    ]);
    await openFirstDraft();

    expect(
      screen.getByText("The video to finish processing (Video & chapters tab)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("asks for the reward to be saved when it is only on screen", async () => {
    renderLive([{ ...submittable(), rewardPoints: 5 }]);
    await openFirstDraft();

    expect(
      screen.getByText("Your reward changes saved with “Save reward” (Reward tab)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });

  it("submits when nothing is missing, and shows the API's own list if it still refuses", async () => {
    submit.mockResolvedValue({
      ok: false,
      code: "campaign_not_ready",
      message: "This campaign can't go to review yet.",
      details: { missing: ["questions"], questionsNeeded: 3, questionsHave: 1 },
    });
    renderLive([submittable()]);
    await openFirstDraft();
    expect(screen.queryByText("Before you submit, this campaign needs:")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("At least 3 questions; you have 1 (Questions tab)."),
    ).toBeInTheDocument();
  });

  it("does not let a refusal follow the author to other tabs", async () => {
    submit.mockResolvedValue({
      ok: false,
      code: "creative_blocked",
      message: "The title or synopsis breaks the content rules. Change it and submit again.",
    });
    const user = userEvent.setup();
    renderLive([submittable()]);
    await openFirstDraft();

    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText(/breaks the content rules/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Reward" }));
    expect(screen.queryByText(/breaks the content rules/)).not.toBeInTheDocument();
  });
});
