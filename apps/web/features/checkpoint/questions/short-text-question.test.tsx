import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/checkpoint.json";
import { shortTextFixture } from "../checkpoint-question-fixtures";
import type { ShortTextAnswer } from "../checkpoint-types";
import { ShortTextQuestionView } from "./short-text-question";

/** `ShortTextQuestionView` reads its label/help text from `useTranslations("checkpoint")` (YT-0405). */
function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ checkpoint: idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

interface ControlledWrapperProps {
  onAnswerChange: (answer: ShortTextAnswer) => void;
}

/** ShortTextQuestionView is a controlled input; a wrapper that actually holds state is needed to type into it realistically. */
function ControlledWrapper({ onAnswerChange }: ControlledWrapperProps) {
  const [answer, setAnswer] = useState<ShortTextAnswer | undefined>(undefined);
  return (
    <ShortTextQuestionView
      question={shortTextFixture}
      answer={answer}
      onAnswerChange={(next) => {
        setAnswer(next);
        onAnswerChange(next);
      }}
    />
  );
}

describe("ShortTextQuestionView", () => {
  it("renders a real, labelled text field", () => {
    renderWithIntl(
      <ShortTextQuestionView
        question={shortTextFixture}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Jawaban Anda (opsional)")).toBeInTheDocument();
  });

  it("enforces the question's maxLength", () => {
    renderWithIntl(
      <ShortTextQuestionView
        question={shortTextFixture}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Jawaban Anda (opsional)")).toHaveAttribute(
      "maxlength",
      String(shortTextFixture.maxLength),
    );
  });

  it("reports typed text as it is entered", async () => {
    const onAnswerChange = vi.fn();
    renderWithIntl(<ControlledWrapper onAnswerChange={onAnswerChange} />);
    const field = screen.getByLabelText("Jawaban Anda (opsional)");

    await userEvent.type(field, "Kesan saya bagus");

    expect(field).toHaveValue("Kesan saya bagus");
    expect(onAnswerChange).toHaveBeenLastCalledWith({
      type: "short_text",
      text: "Kesan saya bagus",
    });
  });
});
