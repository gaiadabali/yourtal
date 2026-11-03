import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PresentedQuestion } from "@yourtal/contracts/question/presented-question";
import { CheckpointOverlay } from "./checkpoint-overlay";

const LONG = "Rewards come from local brands who want you to know what they make and sell nearby";
const question: PresentedQuestion = {
  id: "q-1",
  campaignId: "11111111-1111-4111-8111-111111111111",
  prompt: "Which of these did the presenter say about how local brands share their rewards?",
  timerSeconds: 30,
  type: "multiple_choice",
  options: [
    { id: "a", label: LONG },
    { id: "b", label: "Every reward is paid for by the people watching the other videos" },
    { id: "c", label: "Nothing is paid out until the whole video has been watched" },
  ],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("CheckpointOverlay layout (the browser measures it in rendered/player-checkpoint.spec.ts)", () => {
  it("sits under the video on a phone and over it from sm up, with a scrolling body and a fixed header", () => {
    render(
      <CheckpointOverlay
        question={question}
        questionNumber={1}
        totalQuestions={1}
        answerTimerMs={30_000}
        onAnswer={() => undefined}
        locale="en-AU"
      />,
    );
    const dialog = screen.getByRole("dialog");
    const classes = dialog.className.split(/\s+/);
    // Not positioned over the video by default: a ~220px box cannot hold three long options.
    expect(classes).not.toContain("absolute");
    expect(classes).toContain("sm:absolute");
    expect(classes).toContain("sm:inset-0");
    // Tall content scrolls inside the question; the timer line never scrolls away with it.
    expect(screen.getByRole("timer").parentElement?.className).toContain("shrink-0");
    expect(screen.getByRole("radiogroup").closest(".overflow-y-auto")).not.toBeNull();
    // Long words and options wrap instead of running out of the box.
    expect(screen.getByRole("heading").className).toContain("break-words");
    expect(screen.getByRole("radio", { name: LONG }).className).toContain("break-words");
  });

  it("takes focus, so a viewer on a phone lands on the question", () => {
    render(
      <CheckpointOverlay
        question={question}
        questionNumber={1}
        totalQuestions={1}
        answerTimerMs={30_000}
        onAnswer={() => undefined}
        locale="id-ID"
      />,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByRole("timer")).toHaveTextContent("Sisa 30 dtk");
  });
});

describe("CheckpointOverlay answers", () => {
  it("reports a chosen option as answered in time", () => {
    const onAnswer = vi.fn();
    render(
      <CheckpointOverlay
        question={question}
        questionNumber={1}
        totalQuestions={1}
        answerTimerMs={30_000}
        onAnswer={onAnswer}
        locale="en-AU"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: LONG }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith("a", false);
  });

  it("reports running out of time as unanswered and timed out, once", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(
      <CheckpointOverlay
        question={question}
        questionNumber={1}
        totalQuestions={1}
        answerTimerMs={3_000}
        onAnswer={onAnswer}
        locale="en-AU"
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(null, true);
  });

  it("does not call a question type it cannot show a timeout", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(
      <CheckpointOverlay
        question={{
          id: "q-2",
          campaignId: question.campaignId,
          prompt: "True or false?",
          timerSeconds: 30,
          type: "true_false",
        }}
        questionNumber={1}
        totalQuestions={1}
        answerTimerMs={3_000}
        onAnswer={onAnswer}
        locale="en-AU"
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(null, false);
  });
});
