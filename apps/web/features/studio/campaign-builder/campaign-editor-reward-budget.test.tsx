import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { RegionProvider } from "@/features/region/region-context";
import { StudioIntlProvider } from "../studio-test-i18n";
import { setRewardConfigLive } from "./campaign-builder-actions";
import type { CampaignDraft } from "./campaign-draft";
import { liveAllocation, liveDraft } from "./campaign-draft-live-fixtures";
import { CampaignEditor } from "./campaign-editor";

vi.mock("./campaign-builder-actions", () => ({ setRewardConfigLive: vi.fn() }));

function LiveEditor({
  initial,
  allocations,
}: {
  initial: CampaignDraft;
  allocations: BillingAllocation[];
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <StudioIntlProvider>
      <RegionProvider region="AU">
        <CampaignEditor
          draft={draft}
          onChange={setDraft}
          onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onBack={vi.fn()}
          canEdit
          isVerified
          isLiveMode
          allocations={allocations}
        />
      </RegionProvider>
    </StudioIntlProvider>
  );
}

function draft20s(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    ...liveDraft({ durationSeconds: 20, hlsUrl: "https://media.test/index.m3u8" }),
    ...overrides,
  };
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const BUDGET_500 = { totalBudgetPoints: 500, dailyCapPoints: null };

beforeEach(() => vi.mocked(setRewardConfigLive).mockReset());

describe("Reward and Budget tabs, filled in any order (10.7.b)", () => {
  it("saves from the Budget tab once funding, reward and budget are all in, with no Reward-tab visit", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue({ ok: true, value: draft20s() });
    const allocation = liveAllocation();
    render(
      <LiveEditor
        initial={draft20s({ allocationId: allocation.allocationId, rewardPoints: 2 })}
        allocations={[allocation]}
      />,
    );
    await userEvent.click(tab("Budget"));
    const total = screen.getByRole("spinbutton", { name: "Total budget (points)" });
    await userEvent.clear(total);
    await userEvent.type(total, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));

    expect(setRewardConfigLive).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "Snap App",
      expect.objectContaining({
        allocationId: allocation.allocationId,
        rewardPointsPerCompletion: 2,
        maxPointsForCampaign: 500,
      }),
    );
    expect(await screen.findByText("Budget saved.")).toBeInTheDocument();
  });

  it("saves from the Reward tab with the budget typed on the Budget tab and never saved", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue({ ok: true, value: draft20s() });
    const allocation = liveAllocation();
    render(<LiveEditor initial={draft20s({ rewardPoints: 2 })} allocations={[allocation]} />);
    await userEvent.click(tab("Budget"));
    const total = screen.getByRole("spinbutton", { name: "Total budget (points)" });
    await userEvent.clear(total);
    await userEvent.type(total, "500");
    await userEvent.click(tab("Reward"));
    await userEvent.selectOptions(screen.getByLabelText("Funded by"), allocation.allocationId);
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    expect(setRewardConfigLive).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "Snap App",
      expect.objectContaining({ maxPointsForCampaign: 500, allocationId: allocation.allocationId }),
    );
  });

  it("names the missing funding on the Reward tab and flags it, when Save budget is pressed first", async () => {
    render(
      <LiveEditor
        initial={draft20s({ rewardPoints: 2, budget: BUDGET_500 })}
        allocations={[liveAllocation()]}
      />,
    );
    await userEvent.click(tab("Budget"));
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));

    expect(setRewardConfigLive).not.toHaveBeenCalled();
    expect(screen.getByTestId("campaign-editor-tab-reward-flag")).toBeInTheDocument();
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Reward tab: Choose what funds this reward/);
    await userEvent.click(within(banner).getByRole("button", { name: "Go to Reward" }));
    expect(screen.getByLabelText("Funded by")).toHaveAttribute("aria-invalid", "true");
  });

  it("names the budget on its own field when Save reward is pressed with funding but no budget", async () => {
    const allocation = liveAllocation();
    render(
      <LiveEditor
        initial={draft20s({ allocationId: allocation.allocationId, rewardPoints: 2 })}
        allocations={[allocation]}
      />,
    );
    await userEvent.click(tab("Reward"));
    await userEvent.click(screen.getByRole("button", { name: "Save reward" }));

    expect(setRewardConfigLive).not.toHaveBeenCalled();
    expect(screen.getByTestId("campaign-editor-tab-budget-flag")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go to Budget" }));
    expect(screen.getByRole("spinbutton", { name: "Total budget (points)" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

describe("the reward-ceiling refusal (10.7.c)", () => {
  const ceiling = {
    ok: false as const,
    code: "reward_exceeds_ceiling",
    message: "server wording",
    details: { maxPoints: 2, durationSeconds: 20, hasBonus: false },
  };
  const ceilingText =
    "A 20-second video can pay at most 2 points to each viewer. Lower the reward to 2 or less.";

  it("sits beside the reward field and flags the Reward tab, even when Save budget was pressed", async () => {
    vi.mocked(setRewardConfigLive).mockResolvedValue(ceiling);
    const allocation = liveAllocation();
    render(
      <LiveEditor
        initial={draft20s({
          allocationId: allocation.allocationId,
          rewardPoints: 3,
          budget: BUDGET_500,
        })}
        allocations={[allocation]}
      />,
    );
    await userEvent.click(tab("Budget"));
    await userEvent.click(screen.getByRole("button", { name: "Save budget" }));

    // On the Budget tab it is only pointed at, never worded as a budget problem.
    expect(await screen.findByRole("alert")).toHaveTextContent(`Reward tab: ${ceilingText}`);
    expect(screen.getByTestId("campaign-editor-tab-reward-flag")).toBeInTheDocument();
    expect(screen.queryByTestId("campaign-editor-tab-budget-flag")).not.toBeInTheDocument();

    await userEvent.click(tab("Reward"));
    const reward = screen.getByRole("spinbutton", { name: "Reward (points)" });
    expect(reward).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(ceilingText)).toBeInTheDocument();
    // The flag goes with the next edit.
    await userEvent.clear(reward);
    await userEvent.type(reward, "2");
    expect(screen.queryByTestId("campaign-editor-tab-reward-flag")).not.toBeInTheDocument();
    expect(screen.queryByText(ceilingText)).not.toBeInTheDocument();
  });
});
