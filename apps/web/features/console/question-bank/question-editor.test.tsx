import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { QuestionDraft } from "./question-draft";
import { createEmptyQuestionDraft } from "./question-draft";
import { QuestionEditor } from "./question-editor";

const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000900";

function StatefulEditor({ initial }: { initial: QuestionDraft }) {
  const [draft, setDraft] = useState(initial);
  return <QuestionEditor draft={draft} onChange={setDraft} />;
}

describe("QuestionEditor", () => {
  it("renders the shared prompt and timer fields for every question type", () => {
    for (const type of [
      "multiple_choice",
      "true_false",
      "likert",
      "ranked",
      "short_text",
    ] as const) {
      const { unmount } = render(
        <StatefulEditor initial={createEmptyQuestionDraft(type, CAMPAIGN_ID)} />,
      );
      expect(screen.getByRole("textbox", { name: "Question prompt" })).toBeInTheDocument();
      expect(screen.getByRole("spinbutton", { name: "Timer (seconds)" })).toBeInTheDocument();
      unmount();
    }
  });

  it("dispatches to the multiple_choice fields, with an accessible radio per option", () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("multiple_choice", CAMPAIGN_ID)} />);
    expect(screen.getByRole("button", { name: "Add option" })).toBeInTheDocument();
  });

  it("dispatches to the true_false fields", () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("true_false", CAMPAIGN_ID)} />);
    expect(screen.getByRole("radio", { name: "True" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "False" })).toBeInTheDocument();
  });

  it("dispatches to the likert fields", () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("likert", CAMPAIGN_ID)} />);
    expect(screen.getByRole("textbox", { name: /Low end/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /High end/ })).toBeInTheDocument();
  });

  it("dispatches to the ranked fields", () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("ranked", CAMPAIGN_ID)} />);
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
  });

  it("dispatches to the short_text fields", () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("short_text", CAMPAIGN_ID)} />);
    expect(
      screen.getByRole("spinbutton", { name: "Maximum answer length (characters)" }),
    ).toBeInTheDocument();
  });

  it("shows the PII rejection inline, with the reason, as the author types", async () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("short_text", CAMPAIGN_ID)} />);
    const prompt = screen.getByRole("textbox", { name: "Question prompt" });
    await userEvent.type(prompt, "What is your phone number?");
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("phone number");
  });

  it("shows no PII error for an ordinary comprehension question", async () => {
    render(<StatefulEditor initial={createEmptyQuestionDraft("short_text", CAMPAIGN_ID)} />);
    const prompt = screen.getByRole("textbox", { name: "Question prompt" });
    await userEvent.type(prompt, "What discount did the video mention?");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
