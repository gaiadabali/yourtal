import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckpointResult } from "./checkpoint-result";
import { makeCampaignFixture, multipleChoiceFixture, trueFalseFixture } from "./checkpoint-question-fixtures";
import type { QuestionAnswer } from "./checkpoint-types";
import { toPoints } from "@yourtal/contracts/money";

const questions = [multipleChoiceFixture, trueFalseFixture];

describe("CheckpointResult", () => {
  it("shows base reward and accuracy bonus as two separate, distinctly labelled figures", () => {
    const campaign = makeCampaignFixture({ rewardPoints: toPoints(1000) });
    const answers = new Map<string, QuestionAnswer>([
      [multipleChoiceFixture.id, { type: "multiple_choice", selectedOptionId: multipleChoiceFixture.correctOptionId }],
      [trueFalseFixture.id, { type: "true_false", value: !trueFalseFixture.correctAnswer }],
    ]);
    render(<CheckpointResult campaign={campaign} questions={questions} answers={answers} />);

    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText(/Dijamin/)).toBeInTheDocument();
    expect(screen.getByText("Bonus akurasi")).toBeInTheDocument();

    // Base (600) and bonus (200 at 50% accuracy) render as distinct figures — never one combined number only.
    expect(screen.getByText("600 poin")).toBeInTheDocument();
    expect(screen.getByText("200 poin")).toBeInTheDocument();
    expect(screen.getByText("800 poin")).toBeInTheDocument();
  });

  it("states plainly when a campaign has no accuracy bonus, rather than omitting the section silently", () => {
    const campaign = makeCampaignFixture({ scoringRule: "base_only", rewardPoints: toPoints(500) });
    render(<CheckpointResult campaign={campaign} questions={questions} answers={new Map()} />);

    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText(/tidak memiliki bonus akurasi/)).toBeInTheDocument();
    expect(screen.queryByText("Bonus akurasi")).not.toBeInTheDocument();
  });
});
