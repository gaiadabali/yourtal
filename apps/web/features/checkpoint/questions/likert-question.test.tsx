import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { likertFixture } from "../checkpoint-question-fixtures";
import { LikertQuestionView } from "./likert-question";

function renderView() {
  render(
    <div>
      <h2 id="prompt">{likertFixture.prompt}</h2>
      <LikertQuestionView
        question={likertFixture}
        answer={undefined}
        onAnswerChange={vi.fn()}
        promptId="prompt"
      />
    </div>,
  );
}

describe("LikertQuestionView", () => {
  it("renders one option per scale value", () => {
    renderView();
    const span = likertFixture.scaleMax - likertFixture.scaleMin + 1;
    expect(screen.getAllByRole("radio")).toHaveLength(span);
  });

  it("labels the scale endpoints with their text, not a bare number", () => {
    renderView();
    expect(
      screen.getByRole("radio", {
        name: `${likertFixture.scaleMin} - ${likertFixture.scaleLowLabel}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: `${likertFixture.scaleMax} - ${likertFixture.scaleHighLabel}`,
      }),
    ).toBeInTheDocument();
  });

  it("leaves interior scale values in their natural low-to-high order (not shuffled)", () => {
    renderView();
    const radios = screen.getAllByRole("radio");
    const orderedIds = radios.map((radio) => radio.id.split("-").at(-1));
    const expectedIds = Array.from(
      { length: likertFixture.scaleMax - likertFixture.scaleMin + 1 },
      (_unused, index) => String(likertFixture.scaleMin + index),
    );
    expect(orderedIds).toStrictEqual(expectedIds);
  });
});
