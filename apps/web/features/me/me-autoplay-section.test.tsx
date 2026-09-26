import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import { MeAutoplaySection } from "./me-autoplay-section";
import { setAutoplayAction } from "./me-actions";

vi.mock("./me-actions", () => ({ setAutoplayAction: vi.fn() }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MeAutoplaySection", () => {
  it("selecting a segment saves immediately", async () => {
    vi.mocked(setAutoplayAction).mockResolvedValue({ ok: true, data: { autoplay: "never" } });
    const user = userEvent.setup();
    renderWithIntl(<MeAutoplaySection initialAutoplay="always" />);

    await user.click(screen.getByRole("radio", { name: "Never" }));

    expect(setAutoplayAction).toHaveBeenCalledWith("never");
  });

  it("shows an inline error and keeps the optimistic value on failure", async () => {
    vi.mocked(setAutoplayAction).mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const user = userEvent.setup();
    renderWithIntl(<MeAutoplaySection initialAutoplay="always" />);

    await user.click(screen.getByRole("radio", { name: "Wi-Fi only" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
