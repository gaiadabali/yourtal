import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CounterShell } from "./counter-shell";

describe("CounterShell", () => {
  it("sets data-surface=counter and renders the header and children slots", () => {
    const { container } = render(
      <CounterShell header={<h1>Warung Kopi Kenangan</h1>}>
        <p>Scan the customer's voucher QR</p>
      </CounterShell>,
    );
    expect(container.firstChild).toHaveAttribute("data-surface", "counter");
    expect(screen.getByRole("heading", { name: "Warung Kopi Kenangan" })).toBeInTheDocument();
    expect(screen.getByText("Scan the customer's voucher QR")).toBeInTheDocument();
  });

  it("renders the nav slot when given one", () => {
    render(
      <CounterShell header="Header" nav={<button type="button">History</button>}>
        body
      </CounterShell>,
    );
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("renders no nav row when none is given", () => {
    render(<CounterShell header="Header">body</CounterShell>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
