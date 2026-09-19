import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { multipleChoiceFixture } from "../checkpoint-question-fixtures";
import { MultipleChoiceQuestionView } from "./multiple-choice-question";

function renderView(onAnswerChange = vi.fn()) {
  render(
    <div>
      <h2 id="prompt">{multipleChoiceFixture.prompt}</h2>
      <MultipleChoiceQuestionView
        question={multipleChoiceFixture}
        respondentId="respondent-1"
        answer={undefined}
        onAnswerChange={onAnswerChange}
        promptId="prompt"
      />
    </div>,
  );
  return onAnswerChange;
}

describe("MultipleChoiceQuestionView", () => {
  it("renders every option, real radio semantics", () => {
    renderView();
    expect(screen.getAllByRole("radio")).toHaveLength(multipleChoiceFixture.options.length);
    for (const option of multipleChoiceFixture.options) {
      expect(screen.getByRole("radio", { name: option.label })).toBeInTheDocument();
    }
  });

  it("shuffles option order deterministically for the same respondent, not randomly per render", () => {
    const { unmount } = render(
      <div>
        <h2 id="prompt">{multipleChoiceFixture.prompt}</h2>
        <MultipleChoiceQuestionView
          question={multipleChoiceFixture}
          respondentId="respondent-1"
          answer={undefined}
          onAnswerChange={vi.fn()}
          promptId="prompt"
        />
      </div>,
    );
    const firstOrder = screen.getAllByRole("radio").map((radio) => radio.id);
    unmount();

    render(
      <div>
        <h2 id="prompt">{multipleChoiceFixture.prompt}</h2>
        <MultipleChoiceQuestionView
          question={multipleChoiceFixture}
          respondentId="respondent-1"
          answer={undefined}
          onAnswerChange={vi.fn()}
          promptId="prompt"
        />
      </div>,
    );
    const secondOrder = screen.getAllByRole("radio").map((radio) => radio.id);

    expect(secondOrder).toStrictEqual(firstOrder);
  });

  it("reports the selected option's real id, independent of its shuffled display position", async () => {
    const onAnswerChange = renderView();
    const correctOption = multipleChoiceFixture.options.find(
      (option) => option.id === multipleChoiceFixture.correctOptionId,
    );
    await userEvent.click(screen.getByRole("radio", { name: correctOption?.label ?? "" }));
    expect(onAnswerChange).toHaveBeenCalledWith({
      type: "multiple_choice",
      selectedOptionId: multipleChoiceFixture.correctOptionId,
    });
  });
});
