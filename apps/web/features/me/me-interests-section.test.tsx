import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import { MeInterestsSection } from "./me-interests-section";
import { updateInterestsAction } from "./me-actions";

vi.mock("./me-actions", () => ({ updateInterestsAction: vi.fn() }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MeInterestsSection", () => {
  it("renders every real taxonomy root category and reflects the initial selection", () => {
    renderWithIntl(<MeInterestsSection initialNodeIds={["travel"]} />);
    expect(screen.getByRole("checkbox", { name: "Travel" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Food and drink" })).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("toggling calls updateInterestsAction with the full next set", async () => {
    vi.mocked(updateInterestsAction).mockResolvedValue({
      ok: true,
      data: { nodeIds: ["travel", "fashion"] },
    });
    const user = userEvent.setup();
    renderWithIntl(<MeInterestsSection initialNodeIds={["travel"]} />);

    await user.click(screen.getByRole("checkbox", { name: "Fashion" }));

    expect(updateInterestsAction).toHaveBeenCalledWith(["travel", "fashion"]);
  });
});
