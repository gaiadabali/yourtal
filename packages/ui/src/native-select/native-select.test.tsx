import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NativeSelect } from "./native-select";

function renderSelect() {
  return render(
    <NativeSelect label="Sort" defaultValue="newest">
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
    </NativeSelect>,
  );
}

describe("NativeSelect", () => {
  it("associates a real <label> with a native <select>", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "Sort" });
    expect(select.tagName).toBe("SELECT");
    const label = screen.getByText("Sort");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", select.id);
  });

  it("keeps the label in the accessibility tree even when visually hidden", () => {
    render(
      <NativeSelect label="District" hideLabel>
        <option value="a">A</option>
      </NativeSelect>,
    );
    expect(screen.getByRole("combobox", { name: "District" })).toBeInTheDocument();
  });

  it("changes value via keyboard/native select interaction", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.change(select, { target: { value: "oldest" } });
    expect(select).toHaveValue("oldest");
  });

  it("wires help text and marks the field invalid when there is an error", () => {
    render(
      <NativeSelect label="Region" helpText="Pick your region" errorMessage="Required">
        <option value="au">AU</option>
      </NativeSelect>,
    );
    const select = screen.getByRole("combobox", { name: "Region" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByText("Pick your region")).toBeInTheDocument();
  });
});
