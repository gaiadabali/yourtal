import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeConsentSection } from "./me-consent-section";
import { defaultConsentPreferences } from "./me-consent";

const NOW = "2026-09-19T00:00:00.000Z";

describe("MeConsentSection", () => {
  it("renders essential as a locked, non-interactive row — no switch role for it", () => {
    render(
      <MeConsentSection
        locale="en-AU"
        preferences={defaultConsentPreferences(NOW)}
        interestIds={[]}
        onPurposeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Always on")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("personalisation toggle visibly changes the board-order preview text", async () => {
    const user = userEvent.setup();
    const onPurposeChange = vi.fn();
    const { rerender } = render(
      <MeConsentSection
        locale="en-AU"
        preferences={defaultConsentPreferences(NOW)}
        interestIds={["travel", "food"]}
        onPurposeChange={onPurposeChange}
      />,
    );

    expect(screen.getByText(/default, not personalised to you/)).toBeInTheDocument();

    const personalizeSwitch = screen.getByRole("switch", { name: /Personalise which campaigns/ });
    expect(personalizeSwitch).toHaveAttribute("aria-checked", "false");
    await user.click(personalizeSwitch);
    expect(onPurposeChange).toHaveBeenCalledWith("personalize", true);

    // The parent owns state; simulate its re-render after the callback, as `me-settings-client.tsx` does.
    rerender(
      <MeConsentSection
        locale="en-AU"
        preferences={{ ...defaultConsentPreferences(NOW), personalize: true }}
        interestIds={["travel", "food"]}
        onPurposeChange={onPurposeChange}
      />,
    );
    expect(screen.getByText(/Travel, Food & drink first/)).toBeInTheDocument();
  });

  it("personalisation-on with no interests explains why the board isn't sorted yet", () => {
    render(
      <MeConsentSection
        locale="en-AU"
        preferences={{ ...defaultConsentPreferences(NOW), personalize: true }}
        interestIds={[]}
        onPurposeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/haven't chosen any interests yet/)).toBeInTheDocument();
  });

  it("marketing toggle visibly swaps the message preview, and withdrawal is one click like granting", async () => {
    const user = userEvent.setup();
    const onPurposeChange = vi.fn();
    const { rerender } = render(
      <MeConsentSection
        locale="en-AU"
        preferences={{ ...defaultConsentPreferences(NOW), marketing: true }}
        interestIds={[]}
        onPurposeChange={onPurposeChange}
      />,
    );
    expect(screen.getByText(/Kopi Kenangan/)).toBeInTheDocument();

    const marketingSwitch = screen.getByRole("switch", { name: /marketing messages/ });
    expect(marketingSwitch).toHaveAttribute("aria-checked", "true");
    await user.click(marketingSwitch);
    expect(onPurposeChange).toHaveBeenCalledWith("marketing", false);

    rerender(
      <MeConsentSection
        locale="en-AU"
        preferences={defaultConsentPreferences(NOW)}
        interestIds={[]}
        onPurposeChange={onPurposeChange}
      />,
    );
    expect(screen.getByText("You won't receive marketing messages.")).toBeInTheDocument();
  });

  it("renders id-ID copy for the id-ID locale", () => {
    render(
      <MeConsentSection
        locale="id-ID"
        preferences={defaultConsentPreferences(NOW)}
        interestIds={[]}
        onPurposeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Kontrol persetujuan")).toBeInTheDocument();
  });
});
