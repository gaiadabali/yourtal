import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeReferralsSection } from "./me-referrals-section";

describe("MeReferralsSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  /**
   * `@testing-library/user-event`'s own `setup()` installs its own clipboard
   * stub, so this must be defined AFTER `userEvent.setup()` runs in each
   * test — defining it in `beforeEach` (which runs before `setup()`) gets
   * silently overwritten, and the assertion below would see zero calls even
   * though the component's real behaviour is correct.
   */
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it("renders a real, persisted, copyable code and never claims a referral reward is live", () => {
    render(<MeReferralsSection locale="en-AU" />);
    expect(screen.getByText(/^YT-[A-Z2-9]{6}$/)).toBeInTheDocument();
    expect(screen.getByText(/available yet/)).toBeInTheDocument();
  });

  it("copying shows the same confirmation feedback both times, and reuses the same code across renders", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    const { unmount } = render(<MeReferralsSection locale="en-AU" />);
    const codeText = screen.getByText(/^YT-[A-Z2-9]{6}$/).textContent ?? "";

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(codeText);

    unmount();
    render(<MeReferralsSection locale="en-AU" />);
    expect(screen.getByText(codeText)).toBeInTheDocument();
  });
});
