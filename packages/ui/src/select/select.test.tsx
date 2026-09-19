import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

// jsdom implements neither pointer capture nor scrollIntoView, both of which
// Radix Select's internal pointer/keyboard handling calls unconditionally.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function renderSelect() {
  return render(
    <Select defaultValue="jakarta">
      <SelectTrigger aria-label="District">
        <SelectValue placeholder="Choose a district" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="jakarta">Jakarta Pusat</SelectItem>
        <SelectItem value="bandung">Bandung</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe("Select", () => {
  it("renders a closed combobox trigger with the selected value", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "District" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Jakarta Pusat");
  });

  it("opens a listbox of options on click", async () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "District" }));

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("selects an option on click and closes the listbox", async () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "District" }));
    await screen.findByRole("listbox");

    fireEvent.click(screen.getByRole("option", { name: "Bandung" }));

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "District" })).toHaveTextContent("Bandung");
  });

  it("closes on Escape without changing the selection", async () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "District" });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");

    fireEvent.keyDown(listbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent("Jakarta Pusat");
  });
});
