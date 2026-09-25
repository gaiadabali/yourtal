import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListRow } from "./list-row";

describe("ListRow", () => {
  it("renders title and subtitle as plain text when static", () => {
    render(<ListRow title="Acme Coffee" subtitle="120 points" />);
    expect(screen.getByText("Acme Coffee")).toBeInTheDocument();
    expect(screen.getByText("120 points")).toBeInTheDocument();
  });

  it("renders as a link that makes the whole row the target", () => {
    render(<ListRow title="Acme Coffee" href="/brands/acme" />);
    const link = screen.getByRole("link", { name: /Acme Coffee/ });
    expect(link).toHaveAttribute("href", "/brands/acme");
  });

  it("renders as a button and fires onClick", () => {
    const onClick = vi.fn();
    render(<ListRow title="Acme Coffee" onClick={onClick} />);
    const button = screen.getByRole("button", { name: /Acme Coffee/ });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders leading and trailing slots", () => {
    render(
      <ListRow
        title="Acme Coffee"
        leading={<span data-testid="leading" />}
        trailing={<span data-testid="trailing" />}
      />,
    );
    expect(screen.getByTestId("leading")).toBeInTheDocument();
    expect(screen.getByTestId("trailing")).toBeInTheDocument();
  });

  it("keeps a 44px minimum height", () => {
    render(<ListRow title="Acme Coffee" />);
    expect(screen.getByText("Acme Coffee").closest(".min-h-control")).toBeInTheDocument();
  });
});
