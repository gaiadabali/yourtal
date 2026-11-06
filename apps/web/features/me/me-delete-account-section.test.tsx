import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import { MeDeleteAccountSection } from "./me-delete-account-section";
import { deleteAccountAction } from "./me-actions";

vi.mock("./me-actions", () => ({ deleteAccountAction: vi.fn().mockResolvedValue({ ok: false }) }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("MeDeleteAccountSection", () => {
  it("says the apps you sign in to with YourTal are told and erase what they hold", () => {
    renderWithIntl(<MeDeleteAccountSection />);

    expect(
      screen.getByText(
        "Apps you sign in to with YourTal, such as SnapApp and Free Tax Returns, are told, and delete what they hold about you within 3 days. They keep only records the law requires. Download anything you need from them first.",
      ),
    ).toBeInTheDocument();
  });

  it("the delete button in the confirmation dialog stays disabled until the checkbox is ticked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MeDeleteAccountSection />);

    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    const dialog = await screen.findByRole("dialog");
    const dialogDeleteButton = within(dialog).getByRole("button", { name: "Delete my account" });
    expect(dialogDeleteButton).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox"));
    expect(dialogDeleteButton).toBeEnabled();

    await user.click(dialogDeleteButton);
    expect(deleteAccountAction).toHaveBeenCalledOnce();
    // A refusal keeps the viewer here and says nothing changed.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("wasn't deleted");
  });
});
