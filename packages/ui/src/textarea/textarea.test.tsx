import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("associates a real <label> with the field via htmlFor/id", () => {
    render(<Textarea label="Feedback" />);
    const textarea = screen.getByRole("textbox", { name: "Feedback" });
    const label = screen.getByText("Feedback");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", textarea.id);
  });

  it("keeps the label in the accessibility tree even when visually hidden", () => {
    render(<Textarea label="Notes" hideLabel />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
  });

  it("accepts keyboard input and reflects typed value", () => {
    render(<Textarea label="Description" />);
    const textarea = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(textarea, { target: { value: "Warung Bu Sri, campaign notes" } });
    expect(textarea).toHaveValue("Warung Bu Sri, campaign notes");
  });

  it("wires help text and marks the field invalid when there is an error", () => {
    render(<Textarea label="Bio" helpText="Shown on your profile" errorMessage="Too long" />);
    const textarea = screen.getByRole("textbox", { name: "Bio" });
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Too long");
    expect(screen.getByText("Shown on your profile")).toBeInTheDocument();
  });
});
