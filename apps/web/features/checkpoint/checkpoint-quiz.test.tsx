import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { RegionProvider } from "@/features/region/region-context";
import idID from "@/messages/id-ID/checkpoint.json";
import { CheckpointQuiz } from "./checkpoint-quiz";
import {
  makeCampaignFixture,
  multipleChoiceFixture,
  shortTextFixture,
  trueFalseFixture,
} from "./checkpoint-question-fixtures";
import { toPoints } from "@yourtal/contracts/money";

/** `CheckpointQuiz` renders `CheckpointResult`, a Client Component that reads the region and its translations ambiently (YT-0405) — see `checkpoint-result.test.tsx`. */
function renderQuiz(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ checkpoint: idID }}>
      <RegionProvider region="ID">{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

describe("CheckpointQuiz", () => {
  it("walks through one question at a time, in order, then shows the result screen with base and bonus separated", async () => {
    const campaign = makeCampaignFixture({ rewardPoints: toPoints(1000), questionCount: 3 });
    const questions = [multipleChoiceFixture, trueFalseFixture, shortTextFixture];

    renderQuiz(
      <CheckpointQuiz campaign={campaign} questions={questions} respondentId="respondent-1" />,
    );

    // Question 1 of 3: multiple choice.
    expect(screen.getByText("Pertanyaan 1 dari 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: multipleChoiceFixture.prompt })).toBeInTheDocument();
    const correctOption = multipleChoiceFixture.options.find(
      (option) => option.id === multipleChoiceFixture.correctOptionId,
    );
    await userEvent.click(screen.getByRole("radio", { name: correctOption?.label ?? "" }));
    await userEvent.click(screen.getByRole("button", { name: "Lanjut" }));

    // Question 2 of 3: true/false.
    expect(screen.getByText("Pertanyaan 2 dari 3")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("radio", { name: trueFalseFixture.correctAnswer ? "Benar" : "Salah" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Lanjut" }));

    // Question 3 of 3: short text (optional) — Lanjut reads "Lihat hasil" on the last question.
    expect(screen.getByText("Pertanyaan 3 dari 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lihat hasil" }));

    // Result screen: base reward and accuracy bonus are separate, labelled figures.
    expect(screen.getByText("Checkpoint selesai")).toBeInTheDocument();
    expect(screen.getByText("Reward dasar")).toBeInTheDocument();
    expect(screen.getByText("Bonus akurasi")).toBeInTheDocument();
    expect(screen.getByText("600 poin")).toBeInTheDocument();
    // Both scored questions answered correctly => full 400-point bonus.
    expect(screen.getByText("400 poin")).toBeInTheDocument();
  });

  it("shows the result screen immediately for a campaign with zero checkpoint questions", () => {
    const campaign = makeCampaignFixture({
      questionCount: 0,
      scoringRule: "base_only",
      rewardPoints: toPoints(300),
    });
    renderQuiz(<CheckpointQuiz campaign={campaign} questions={[]} />);
    expect(screen.getByText("Checkpoint selesai")).toBeInTheDocument();
    // base_only with no accuracy bonus: base and total are both 300 poin,
    // so the figure legitimately appears twice (once per row).
    expect(screen.getAllByText("300 poin")).toHaveLength(2);
    expect(screen.getByText(/tidak memiliki bonus akurasi/)).toBeInTheDocument();
  });
});
