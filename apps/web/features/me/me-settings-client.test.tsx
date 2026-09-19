import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeSettingsClient } from "./me-settings-client";

describe("MeSettingsClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("wires interests and the personalisation preview together: picking an interest updates the preview live", async () => {
    const user = userEvent.setup();
    render(<MeSettingsClient locale="en-AU" />);

    await user.click(screen.getByRole("switch", { name: /Personalise which campaigns/ }));
    expect(screen.getByText(/haven't chosen any interests yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Travel" }));
    expect(screen.getByText(/Travel first/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Food & drink" }));
    expect(screen.getByText(/Travel, Food & drink first/)).toBeInTheDocument();
  });

  it("persists both consent and interest changes across a remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MeSettingsClient locale="en-AU" />);
    await user.click(screen.getByRole("switch", { name: /marketing messages/ }));
    await user.click(screen.getByRole("button", { name: "Travel" }));
    unmount();

    render(<MeSettingsClient locale="en-AU" />);
    expect(screen.getByRole("switch", { name: /marketing messages/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: "Travel" })).toHaveAttribute("aria-pressed", "true");
  });
});
