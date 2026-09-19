import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionAnswerView } from "./question-answer-view";
import {
  likertFixture,
  multipleChoiceFixture,
  rankedFixture,
  shortTextFixture,
  trueFalseFixture,
} from "./checkpoint-question-fixtures";
import type { Question } from "@yourtal/contracts/question";

function renderQuestion(question: Question) {
  return render(
    <div>
      <h2 id="prompt">{question.prompt}</h2>
      <QuestionAnswerView
        question={question}
        respondentId="respondent-1"
        answer={undefined}
        onAnswerChange={vi.fn()}
        promptId="prompt"
      />
    </div>,
  );
}

describe("QuestionAnswerView — exhaustive dispatch over all five question types", () => {
  it("renders multiple_choice as a radiogroup with every option", () => {
    renderQuestion(multipleChoiceFixture);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(multipleChoiceFixture.options.length);
  });

  it("renders true_false as a two-option radiogroup", () => {
    renderQuestion(trueFalseFixture);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("renders likert as a radiogroup spanning the scale", () => {
    renderQuestion(likertFixture);
    expect(screen.getAllByRole("radio")).toHaveLength(likertFixture.scaleMax - likertFixture.scaleMin + 1);
  });

  it("renders ranked as a keyboard-reorderable list, not a radiogroup", () => {
    renderQuestion(rankedFixture);
    expect(screen.getAllByRole("listitem")).toHaveLength(rankedFixture.items.length);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("renders short_text as a labelled text field", () => {
    renderQuestion(shortTextFixture);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
