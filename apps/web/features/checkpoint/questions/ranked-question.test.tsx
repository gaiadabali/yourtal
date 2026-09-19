import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { rankedFixture } from "../checkpoint-question-fixtures";
import type { RankedAnswer } from "../checkpoint-types";
import { RankedQuestionView } from "./ranked-question";

function renderView(onAnswerChange = vi.fn()) {
  render(
    <div>
      <h2 id="prompt">{rankedFixture.prompt}</h2>
      <RankedQuestionView
        question={rankedFixture}
        respondentId="respondent-1"
        answer={undefined}
        onAnswerChange={onAnswerChange}
        promptId="prompt"
      />
    </div>,
  );
  return onAnswerChange;
}

/**
 * The rendered order is seeded-shuffled (deliberately — see
 * ranked-question.tsx), so it does NOT match `rankedFixture.items`'
 * declaration order. Tests read the actual rendered order back out of the
 * DOM via each row's "Turun: <label>" button rather than assuming any
 * fixed position.
 */
function renderedLabels(): string[] {
  return screen.getAllByRole("listitem").map((item) => {
    const downButton = within(item).getByRole("button", { name: /^Turun:/ });
    return downButton.getAttribute("aria-label")?.replace(/^Turun: /, "") ?? "";
  });
}

describe("RankedQuestionView", () => {
  it("commits an initial ranking as soon as it mounts, so an unmodified order is still a valid answer", () => {
    const onAnswerChange = renderView();
    expect(onAnswerChange).toHaveBeenCalledTimes(1);
    const firstAnswer = onAnswerChange.mock.calls[0]?.[0] as RankedAnswer | undefined;
    expect(firstAnswer?.type).toBe("ranked");
    expect(firstAnswer?.orderedItemIds).toHaveLength(rankedFixture.items.length);
  });

  it("renders a move-up and move-down button for every item, with no drag-and-drop as the only path", () => {
    renderView();
    // 3 items => 3 "Naik" and 3 "Turun" buttons, each named after its item.
    for (const item of rankedFixture.items) {
      expect(screen.getByRole("button", { name: `Naik: ${item.label}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Turun: ${item.label}` })).toBeInTheDocument();
    }
  });

  it("disables move-up for the first rendered item and move-down for the last rendered item", () => {
    renderView();
    const labels = renderedLabels();
    const firstItemLabel = labels[0] ?? "";
    const lastItemLabel = labels.at(-1) ?? "";
    expect(screen.getByRole("button", { name: `Naik: ${firstItemLabel}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Turun: ${lastItemLabel}` })).toBeDisabled();
  });

  it("reorders via the keyboard alone (Enter on a focused button), announces the new position, and keeps focus reachable", async () => {
    const onAnswerChange = renderView();
    const beforeOrder = renderedLabels();
    const middleItemLabel = beforeOrder[1] ?? "";
    const downButton = screen.getByRole("button", { name: `Turun: ${middleItemLabel}` });

    downButton.focus();
    expect(downButton).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const afterOrder = renderedLabels();
    expect(afterOrder).not.toStrictEqual(beforeOrder);

    // The moved item's position advanced by one.
    const movedAnswer = onAnswerChange.mock.calls.at(-1)?.[0] as RankedAnswer | undefined;
    expect(movedAnswer?.type).toBe("ranked");

    // A live region announced the move in human terms, not just changed the DOM silently.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(new RegExp(`${middleItemLabel} dipindahkan ke posisi`));

    // Focus lands on a real, enabled, reachable button after the reorder —
    // the keyboard flow is never dropped mid-operation.
    expect(document.activeElement).toHaveAttribute("type", "button");
    expect(document.activeElement).not.toBeDisabled();
  });

  it("moving the middle item to the last position disables its own move-down and redirects focus to move-up", async () => {
    renderView();
    const beforeOrder = renderedLabels();
    const middleItemLabel = beforeOrder[1] ?? "";
    const originalLastItemLabel = beforeOrder.at(-1) ?? "";

    // The middle item (of 3) moves down once and becomes last, at which
    // point its own "Turun" disables and focus must redirect to its
    // now-enabled "Naik" rather than being lost on a disabled button.
    await userEvent.click(screen.getByRole("button", { name: `Turun: ${middleItemLabel}` }));

    expect(renderedLabels().at(-1)).toBe(middleItemLabel);
    expect(screen.getByRole("button", { name: `Turun: ${middleItemLabel}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Naik: ${middleItemLabel}` })).toHaveFocus();
    expect(screen.getByRole("button", { name: `Turun: ${originalLastItemLabel}` })).not.toBeDisabled();
  });
});
