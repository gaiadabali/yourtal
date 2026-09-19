import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input } from "./input";

describe("Input", () => {
  it("associates a real <label> with the field via htmlFor/id", () => {
    render(<Input label="Phone number" />);
    const input = screen.getByRole("textbox", { name: "Phone number" });
    const label = screen.getByText("Phone number");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
  });

  it("keeps the label in the accessibility tree even when visually hidden", () => {
    render(<Input label="Search" hideLabel />);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
  });

  it("accepts keyboard input and reflects typed value", () => {
    render(<Input label="Merchant name" />);
    const input = screen.getByRole("textbox", { name: "Merchant name" });
    input.focus();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Warung Bu Sri" } });
    expect(input).toHaveValue("Warung Bu Sri");
  });

  it("wires help text and marks the field invalid when there is an error", () => {
    render(<Input label="Email" helpText="We never share this" errorMessage="Enter a valid email" />);
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email");
    expect(screen.getByText("We never share this")).toBeInTheDocument();
  });
});
