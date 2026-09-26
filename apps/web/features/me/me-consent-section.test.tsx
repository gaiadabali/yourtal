import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import { MeConsentSection } from "./me-consent-section";
import { updateConsentAction } from "./me-actions";

vi.mock("./me-actions", () => ({ updateConsentAction: vi.fn() }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MeConsentSection", () => {
  it("essential has no switch; personalize/marketing reflect the latest recorded state", () => {
    renderWithIntl(
      <MeConsentSection
        initialConsents={[
          {
            purpose: "declared_interest_targeting",
            state: "granted",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.queryByRole("switch", { name: /account and fraud prevention/i })).toBeNull();
    expect(screen.getByRole("switch", { name: "Personalise which campaigns I see" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Send me marketing messages" })).not.toBeChecked();
  });

  it("withdrawing calls the real API with state: withdrawn and the settings_toggle source", async () => {
    vi.mocked(updateConsentAction).mockResolvedValue({
      ok: true,
      data: { consents: [] },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <MeConsentSection
        initialConsents={[
          {
            purpose: "declared_interest_targeting",
            state: "granted",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Personalise which campaigns I see" }));

    expect(updateConsentAction).toHaveBeenCalledWith("declared_interest_targeting", false);
  });
});
