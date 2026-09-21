import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import idID from "@/messages/id-ID/checkpoint.json";
import { trueFalseFixture } from "../checkpoint-question-fixtures";
import { TrueFalseQuestionView } from "./true-false-question";

/** `TrueFalseQuestionView` reads its option labels from `useTranslations("checkpoint")` (YT-0405). */
function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="id-ID" messages={{ checkpoint: idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("TrueFalseQuestionView", () => {
  it("renders exactly two options, Benar and Salah", () => {
    renderWithIntl(
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
    renderWithIntl(
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
