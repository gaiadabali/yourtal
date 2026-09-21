import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { RegionProvider } from "@/features/region/region-context";
import idID from "@/messages/id-ID/checkpoint.json";
import { CheckpointQuestionStep } from "./checkpoint-question-step";
import { multipleChoiceFixture, shortTextFixture } from "./checkpoint-question-fixtures";

/** `CheckpointQuestionStep` reads the region and its translations ambiently (YT-0405) — see `checkpoint-result.test.tsx` for the same pattern. */
function renderStep(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ checkpoint: idID }}>
      <RegionProvider region="ID">{ui}</RegionProvider>
    </NextIntlClientProvider>,
  );
}

describe("CheckpointQuestionStep", () => {
  it("shows progress, the prompt, and disables Lanjut until an answer is chosen for a scored type", () => {
    renderStep(
      <CheckpointQuestionStep
        question={multipleChoiceFixture}
        questionNumber={2}
        totalQuestions={4}
        respondentId="respondent-1"
        answer={undefined}
        onAnswerChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText("Pertanyaan 2 dari 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: multipleChoiceFixture.prompt })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjut" })).toBeDisabled();
  });

  it("enables Lanjut once an answer is present, and calls onNext when pressed", async () => {
    const onNext = vi.fn();
    renderStep(
      <CheckpointQuestionStep
        question={multipleChoiceFixture}
        questionNumber={1}
        totalQuestions={1}
        respondentId="respondent-1"
        answer={{
          type: "multiple_choice",
          selectedOptionId: multipleChoiceFixture.correctOptionId,
        }}
        onAnswerChange={vi.fn()}
        onNext={onNext}
      />,
    );

    const button = screen.getByRole("button", { name: "Lihat hasil" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("short_text is always proceed-able, since it is optional", () => {
    renderStep(
      <CheckpointQuestionStep
        question={shortTextFixture}
        questionNumber={1}
        totalQuestions={1}
        respondentId="respondent-1"
        answer={undefined}
        onAnswerChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Lihat hasil" })).toBeEnabled();
  });

  describe("timer expiry", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-advances and disables input when the timer expires", () => {
      vi.useFakeTimers();
      const onNext = vi.fn();
      const onAnswerChange = vi.fn();
      renderStep(
        <CheckpointQuestionStep
          question={{ ...multipleChoiceFixture, timerSeconds: 2 }}
          questionNumber={1}
          totalQuestions={2}
          respondentId="respondent-1"
          answer={undefined}
          onAnswerChange={onAnswerChange}
          onNext={onNext}
        />,
      );

      // One `act()` per second: the countdown re-arms its `setTimeout` from
      // inside a `useEffect`, which only re-runs at an `act()` boundary —
      // see use-question-timer.test.tsx for the full explanation.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(onNext).toHaveBeenCalledTimes(1);
      for (const radio of screen.getAllByRole("radio")) {
        expect(radio).toHaveAttribute("data-disabled");
      }
    });
  });
});
