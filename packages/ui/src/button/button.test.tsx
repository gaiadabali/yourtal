import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders as a button with an accessible name from its children", () => {
    render(<Button>Save changes</Button>);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("is a native, focusable button that fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Submit</Button>);

    const button = screen.getByRole("button", { name: "Submit" });
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is excluded from the tab order and inert when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("disabled");
  });

  it("requires an explicit accessible name for icon-only buttons", () => {
    render(
      <Button size="icon" aria-label="Close">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("forwards props to a custom element via asChild without adding a wrapper", () => {
    render(
      <Button asChild>
        <a href="/rewards">Go to rewards</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go to rewards" });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
  });
});
