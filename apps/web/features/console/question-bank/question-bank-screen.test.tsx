import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionBankScreen } from "./question-bank-screen";

const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000900";
const FIFTEEN_MINUTES = 15 * 60;

describe("QuestionBankScreen", () => {
  it("shows the empty state and the bank-size explanation for a 15-minute video (asks 3, needs 9)", () => {
    render(
      <QuestionBankScreen
        campaignId={CAMPAIGN_ID}
        durationSeconds={FIFTEEN_MINUTES}
        initialBank={[]}
      />,
    );
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
    expect(screen.getByText(/needs at least 9 complete questions/)).toBeInTheDocument();
  });

  it("adds a short-text question end to end and reflects it in the list", async () => {
    const onBankChange = vi.fn();
    render(
      <QuestionBankScreen
        campaignId={CAMPAIGN_ID}
        durationSeconds={FIFTEEN_MINUTES}
        initialBank={[]}
        onBankChange={onBankChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    await userEvent.click(screen.getByRole("button", { name: /Add short free text/i }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "What discount did the video mention?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save question" }));

    expect(screen.getByText("What discount did the video mention?")).toBeInTheDocument();
    expect(onBankChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ prompt: "What discount did the video mention?" }),
      ]),
    );
  });

  it("refuses to save a PII-harvesting question, with the reason shown inline", async () => {
    render(
      <QuestionBankScreen
        campaignId={CAMPAIGN_ID}
        durationSeconds={FIFTEEN_MINUTES}
        initialBank={[]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    await userEvent.click(screen.getByRole("button", { name: /Add short free text/i }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "What is your phone number?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save question" }));

    expect(screen.getByRole("textbox", { name: "Question prompt" })).toHaveValue(
      "What is your phone number?",
    );
    expect(
      screen.getAllByRole("alert").some((node) => node.textContent?.includes("phone number")),
    ).toBe(true);
    expect(screen.getByText("No questions yet.")).toBeInTheDocument(); // never made it into the bank
  });

  it("removes a question from the bank", async () => {
    render(
      <QuestionBankScreen
        campaignId={CAMPAIGN_ID}
        durationSeconds={FIFTEEN_MINUTES}
        initialBank={[]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    await userEvent.click(screen.getByRole("button", { name: /Add short free text/i }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Question prompt" }),
      "Any other feedback?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save question" }));
    expect(screen.getByText("Any other feedback?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No questions yet.")).toBeInTheDocument();
  });

  it("hides the add/edit/remove controls in read-only mode", () => {
    render(
      <QuestionBankScreen
        campaignId={CAMPAIGN_ID}
        durationSeconds={FIFTEEN_MINUTES}
        initialBank={[]}
        readOnly
      />,
    );
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
  });
});
