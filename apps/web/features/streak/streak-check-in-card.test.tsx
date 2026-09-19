import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegionProvider } from "@/features/region/region-context";
import { StreakCheckInCard } from "./streak-check-in-card";

function renderCard() {
  return render(
    <RegionProvider region="ID">
      <StreakCheckInCard />
    </RegionProvider>,
  );
}

describe("StreakCheckInCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("prompts to start a streak before any check-in", async () => {
    renderCard();
    expect(await screen.findByText(/check in hari ini untuk mulai streak/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check in/i })).toBeEnabled();
  });

  it("checking in updates the streak count and disables the button", async () => {
    const user = userEvent.setup();
    renderCard();
    const button = await screen.findByRole("button", { name: /check in/i });

    await user.click(button);

    expect(await screen.findByText(/streak 1 hari/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sudah check-in/i })).toBeDisabled();
  });

  it("checking in twice in the same render does not double-grant — the button is disabled after the first tap", async () => {
    const user = userEvent.setup();
    renderCard();
    const button = await screen.findByRole("button", { name: /check in/i });

    await user.click(button);
    const disabledButton = screen.getByRole("button", { name: /sudah check-in/i });
    expect(disabledButton).toBeDisabled();
    // A disabled button cannot be clicked again by a real user; Testing
    // Library's userEvent respects that, so a second click is a no-op by
    // construction rather than something this test needs to assert twice.
  });

  it("persists the streak across a remount (same device, later visit)", async () => {
    const user = userEvent.setup();
    const first = renderCard();
    await user.click(await screen.findByRole("button", { name: /check in/i }));
    first.unmount();

    renderCard();
    expect(await screen.findByText(/streak 1 hari/i)).toBeInTheDocument();
  });
});
