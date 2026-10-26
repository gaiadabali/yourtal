import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import { setRewardConfigLive } from "./campaign-builder-actions";
import { createChapter } from "./campaign-chapter";
import type { CampaignDraft, CampaignDraftFormValues } from "./campaign-draft";
import { draftFormValues } from "./campaign-draft";
import { campaignDraftFormResolver } from "./campaign-draft-form";
import { createEmptyCampaignDraft } from "./campaign-draft-fixtures";
import { liveAllocation, liveDraft } from "./campaign-draft-live-fixtures";
import { CampaignEditorReward } from "./campaign-editor-reward";

vi.mock("./campaign-builder-actions", () => ({ setRewardConfigLive: vi.fn() }));

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

/**
 * `CampaignEditorReward` takes the same shared React Hook Form instance
 * `campaign-editor.tsx` creates for the real editor (YT-0525) — this
 * harness stands one up the same way, `values`-synced to local `draft`
 * state, so this test still exercises the component in isolation rather
 * than through the full `CampaignEditor` tree.
 */
function StatefulReward({
  initial,
  live = false,
  allocations = [],
}: {
  initial: CampaignDraft;
  live?: boolean;
  allocations?: BillingAllocation[];
}) {
  const [draft, setDraft] = useState(initial);
  const form = useForm<CampaignDraftFormValues>({
    values: draftFormValues(draft),
    resolver: campaignDraftFormResolver,
    mode: "onChange",
  });
  return (
    <StudioIntlProvider>
      <RegionProvider region={live ? "AU" : "ID"}>
        <CampaignEditorReward
          draft={draft}
          form={form}
          onChange={setDraft}
          onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          isLiveMode={live}
          merchantName="Kopi Kenangan"
          allocations={allocations}
        />
      </RegionProvider>
    </StudioIntlProvider>
  );
}

function draftWithDuration(minutes: number, rewardPoints: number): CampaignDraft {
  const draft = createEmptyCampaignDraft(BUSINESS_ID, "Kopi Kenangan");
  draft.chapters = [createChapter("Intro", 0), createChapter("Close", minutes * 60 - 30)];
  draft.rewardPoints = rewardPoints;
  return draft;
}

/** A live draft whose 20-second video has been processed, the case from the founder's walkthrough. */
function twentySecondDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    ...liveDraft({ durationSeconds: 20, hlsUrl: "https://media.test/index.m3u8" }),
    ...overrides,
  };
}

beforeEach(() => vi.mocked(setRewardConfigLive).mockReset());

describe("CampaignEditorReward", () => {
  // task 7.8.c: B (the backing rate) no longer computes a reward's money
  // value client-side, so the ratio banner is honestly "pending" regardless
  // of the points entered, until a server endpoint supplies that value
  // (`campaign-reward-risk.ts`'s doc comment).
  it("shows the ratio as pending rather than guessing it from points alone", () => {
    render(<StatefulReward initial={draftWithDuration(30, 100)} />);
    expect(screen.getByText("Ratio pending")).toBeInTheDocument();
    expect(screen.getByText(/Save the reward to see how it compares/)).toBeInTheDocument();
  });

  it("still shows pending for a large reward — no client-side guess either way", () => {
    render(<StatefulReward initial={draftWithDuration(30, 2_500)} />);
    expect(screen.getByText("Ratio pending")).toBeInTheDocument();
  });

  // B5: a draft with no reward yet is asked for one, not told it is insulting.
  it("asks a 0-point draft to set a reward, and never calls it insulting", () => {
    render(<StatefulReward initial={draftWithDuration(30, 0)} />);
    expect(screen.getByText(/Set a reward to see how it compares/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/insult/i);
  });
});

describe("CampaignEditorReward live (B3, B4)", () => {
  it("names each pot of funded points by when it was bought and what is left, once each, never by id", () => {
    const a = liveAllocation({
      allocationId: "alloc_00000000-0000-4000-9000-000000000001:671fb9fa-d7de",
      createdAt: "2026-10-21T04:05:00.000Z",
    });
    const b = liveAllocation({
      allocationId: "alloc_00000000-0000-4000-9000-000000000001:0938ed4e-a52c",
      createdAt: "2026-10-20T01:30:00.000Z",
      totalPoints: 20_000 as never,
      remainingPoints: 20_000 as never,
    });
    render(<StatefulReward initial={twentySecondDraft()} live allocations={[a, b]} />);

    const select = screen.getByLabelText("Funded by");
    const labels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "Funded by",
      "50,000 points bought 21 Oct 2026, 3:05 pm · 48,800 left",
      "20,000 points bought 20 Oct 2026, 12:30 pm · 20,000 left",
    ]);
    expect(select.textContent).not.toMatch(/alloc_/);
  });

  it("says which choice is missing, on that field, when Save reward is pressed without Funded by", async () => {
    render(<StatefulReward initial={twentySecondDraft()} live allocations={[liveAllocation()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    expect(setRewardConfigLive).not.toHaveBeenCalled();
    const select = screen.getByLabelText("Funded by");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/“Funded by”/);
  });

  it("words the per-minute limit for this video's length, with no code and no bonus for a fixed reward", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue({
      ok: false,
      code: "reward_exceeds_ceiling",
      message: "base reward plus the maximum accuracy bonus exceeds the 8-point ceiling (F14)",
      details: { maxPoints: 2, durationSeconds: 20, hasBonus: false },
    });
    const allocation = liveAllocation();
    render(
      <StatefulReward
        initial={twentySecondDraft({ allocationId: allocation.allocationId, rewardPoints: 3 })}
        live
        allocations={[allocation]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "A 20-second video can pay at most 2 points to each viewer. Lower the reward to 2 or less.",
    );
    expect(alert.textContent).not.toMatch(/F14|ceiling|bonus/i);
  });

  it("mentions the accuracy bonus only when there is one", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue({
      ok: false,
      code: "reward_exceeds_ceiling",
      message: "server wording",
      details: { maxPoints: 1, durationSeconds: 20, hasBonus: true },
    });
    const allocation = liveAllocation();
    render(
      <StatefulReward
        initial={twentySecondDraft({
          allocationId: allocation.allocationId,
          rewardPoints: 1,
          accuracyBonusPoints: 1,
          scoringRule: "base_plus_accuracy_bonus",
        })}
        live
        allocations={[allocation]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A 20-second video can pay at most 1 point to each viewer, reward and accuracy bonus together. Lower them so they add up to 1 or less.",
    );
  });

  it("sends no accuracy bonus for a fixed reward, and hides the bonus field", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue({ ok: true, value: liveDraft() });
    const allocation = liveAllocation();
    render(
      <StatefulReward
        initial={twentySecondDraft({
          allocationId: allocation.allocationId,
          rewardPoints: 2,
          // A number left behind from when the bonus rule was chosen.
          accuracyBonusPoints: 3,
          scoringRule: "base_only",
        })}
        live
        allocations={[allocation]}
      />,
    );
    expect(screen.queryByLabelText("Accuracy bonus (points)")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    expect(setRewardConfigLive).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "Kopi Kenangan",
      expect.objectContaining({ rewardPointsPerCompletion: 2, accuracyBonusPoints: 0 }),
    );
  });

  it("clears a refusal as soon as the reward is changed, and says Saved after a good save", async () => {
    vi.mocked(setRewardConfigLive)
      .mockResolvedValueOnce({
        ok: false,
        code: "reward_exceeds_ceiling",
        message: "x",
        details: { maxPoints: 2, durationSeconds: 20, hasBonus: false },
      })
      .mockResolvedValueOnce({ ok: true, value: liveDraft({ durationSeconds: 20 }) });
    const allocation = liveAllocation();
    render(
      <StatefulReward
        initial={twentySecondDraft({ allocationId: allocation.allocationId, rewardPoints: 3 })}
        live
        allocations={[allocation]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    const reward = screen.getByRole("spinbutton", { name: "Reward (points)" });
    await userEvent.clear(reward);
    await userEvent.type(reward, "2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));
    expect(await screen.findByText("Reward saved.")).toBeInTheDocument();
  });

  it("says the limit depends on the video's length while the length is still unknown", () => {
    render(<StatefulReward initial={liveDraft()} live allocations={[liveAllocation()]} />);
    expect(screen.getByText(/depends on the video's length/)).toBeInTheDocument();
  });
});
