import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { trueFalseFixture } from "../checkpoint-question-fixtures";
import { TrueFalseQuestionView } from "./true-false-question";

describe("TrueFalseQuestionView", () => {
  it("renders exactly two options, Benar and Salah", () => {
    render(
      <div>
        <h2 id="prompt">{trueFalseFixture.prompt}</h2>
        <TrueFalseQuestionView
          question={trueFalseFixture}
          respondentId="respondent-1"
          answer={undefined}
          onAnswerChange={vi.fn()}
          promptId="prompt"
        />
      </div>,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Benar" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Salah" })).toBeInTheDocument();
  });

  it("reports a boolean answer matching the selected option", async () => {
    const onAnswerChange = vi.fn();
    render(
      <div>
        <h2 id="prompt">{trueFalseFixture.prompt}</h2>
        <TrueFalseQuestionView
          question={trueFalseFixture}
          respondentId="respondent-1"
          answer={undefined}
          onAnswerChange={onAnswerChange}
          promptId="prompt"
        />
      </div>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Salah" }));
    expect(onAnswerChange).toHaveBeenCalledWith({ type: "true_false", value: false });
  });
});
