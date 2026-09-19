import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioQuestionGroup } from "./radio-question-group";

const options = [
  { id: "opt-a", label: "Kopi susu" },
  { id: "opt-b", label: "Teh manis" },
  { id: "opt-c", label: "Air mineral" },
];

function renderGroup(onValueChange: (value: string) => void, value?: string) {
  return render(
    <div>
      <h2 id="prompt">Pertanyaan contoh</h2>
      <RadioQuestionGroup
        options={options}
        value={value}
        onValueChange={onValueChange}
        ariaLabelledBy="prompt"
        name="sample"
      />
    </div>,
  );
}

describe("RadioQuestionGroup", () => {
  it("exposes real radio semantics: a labelled radiogroup of radio options", () => {
    renderGroup(vi.fn());
    const group = screen.getByRole("radiogroup", { name: "Pertanyaan contoh" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Kopi susu" })).toBeInTheDocument();
  });

  it("selects an option on click and calls onValueChange", async () => {
    const onValueChange = vi.fn();
    renderGroup(onValueChange);
    await userEvent.click(screen.getByRole("radio", { name: "Teh manis" }));
    expect(onValueChange).toHaveBeenCalledWith("opt-b");
  });

  describe("arrow-key navigation", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * @radix-ui/react-roving-focus moves focus on an arrow key via a
     * `setTimeout(0)` scheduled from the keydown handler (not
     * synchronously), and @radix-ui/react-radio-group gates
     * select-on-focus behind a "was this focus caused by an arrow key?"
     * flag that is set on keydown and cleared again on keyup. In a real
     * keypress the keyup always arrives after that deferred focus has
     * resolved; a zero-delay synthetic keydown+keyup pair (userEvent's
     * default) can clear the flag before the deferred focus runs, so this
     * drives keydown/keyup manually with a fake-timer flush in between —
     * reproducing real keyboard timing instead of racing it.
     */
    function pressArrowDown() {
      const target = document.activeElement as HTMLElement;
      fireEvent.keyDown(target, { key: "ArrowDown" });
      act(() => {
        vi.advanceTimersByTime(0);
      });
      fireEvent.keyUp(document.activeElement as HTMLElement, { key: "ArrowDown" });
    }

    it("moves focus to the next option and selects it, keyboard-only", () => {
      vi.useFakeTimers();
      const onValueChange = vi.fn();
      renderGroup(onValueChange, "opt-a");

      screen.getByRole("radio", { name: "Kopi susu" }).focus();
      expect(screen.getByRole("radio", { name: "Kopi susu" })).toHaveFocus();

      pressArrowDown();
      expect(screen.getByRole("radio", { name: "Teh manis" })).toHaveFocus();
      expect(onValueChange).toHaveBeenLastCalledWith("opt-b");

      pressArrowDown();
      expect(screen.getByRole("radio", { name: "Air mineral" })).toHaveFocus();
      expect(onValueChange).toHaveBeenLastCalledWith("opt-c");
    });
  });

  it("reaches the group via Tab, landing on the checked option (roving tabindex)", async () => {
    renderGroup(vi.fn(), "opt-a");
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Kopi susu" })).toHaveFocus();
  });

  it("marks the currently checked option", () => {
    renderGroup(vi.fn(), "opt-c");
    expect(screen.getByRole("radio", { name: "Air mineral" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Kopi susu" })).not.toBeChecked();
  });
});
