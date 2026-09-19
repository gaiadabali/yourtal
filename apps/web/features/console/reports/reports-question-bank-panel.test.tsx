import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsQuestionBankPanel } from "./reports-question-bank-panel";

describe("ReportsQuestionBankPanel", () => {
  it("renders a real accessible table with one row per question type, not only the decorative chart", () => {
    render(
      <ReportsQuestionBankPanel
        scopeLabel="All campaigns"
        typeCounts={[
          { type: "multiple_choice", label: "Multiple choice", count: 3 },
          { type: "true_false", label: "True / false", count: 1 },
        ]}
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("All campaigns")).toBeInTheDocument();
  });

  it("hides the decorative chart from assistive tech, since the table beside it is the real content", () => {
    const { container } = render(
      <ReportsQuestionBankPanel
        scopeLabel="All campaigns"
        typeCounts={[{ type: "likert", label: "Likert", count: 2 }]}
      />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows an honest empty state rather than an empty chart when nothing is configured", () => {
    render(<ReportsQuestionBankPanel scopeLabel="Test Campaign" typeCounts={[]} />);
    expect(screen.getByText("No questions are configured in this scope.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
