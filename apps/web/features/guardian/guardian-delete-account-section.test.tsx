import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuardianDeleteAccountSection } from "./guardian-delete-account-section";
import { deleteGuardianAccountAction } from "./guardian-actions";

vi.mock("./guardian-actions", () => ({
  deleteGuardianAccountAction: vi.fn(),
}));

const deleteMock = vi.mocked(deleteGuardianAccountAction);

/**
 * 12.4.b (#6): the web render test for the delete action, same harness
 * shape `guardian-granted-panel.test.tsx` uses for its own confirm dialog.
 */
describe("GuardianDeleteAccountSection", () => {
  it("keeps the confirm dialog closed until the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(
      <GuardianDeleteAccountSection
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Alex's account" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Alex's account?")).toBeInTheDocument();
  });

  it("calls the delete action on confirm, and renders the deleted notice on success", async () => {
    deleteMock.mockResolvedValue({ ok: true, data: { deleted: true } });
    const user = userEvent.setup();
    render(
      <GuardianDeleteAccountSection
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Alex's account" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Yes, delete the account" }));

    expect(deleteMock).toHaveBeenCalledWith("tok_1", "key-1");
    expect(await screen.findByText("Alex's YourTal account has been deleted.")).toBeInTheDocument();
    // The dialog and its trigger are both gone — this IS the final state,
    // not a panel a guardian could reopen and delete again.
    expect(screen.queryByRole("button", { name: "Delete Alex's account" })).not.toBeInTheDocument();
  });

  it("shows an error and stays actionable when the action fails", async () => {
    deleteMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const user = userEvent.setup();
    render(
      <GuardianDeleteAccountSection
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Alex's account" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Yes, delete the account" }));

    expect(
      await screen.findByText("YourTal couldn't be reached. Check your connection and try again."),
    ).toBeInTheDocument();
    // Still there to retry — the failure did not render the deleted notice.
    expect(
      within(dialog).getByRole("button", { name: "Yes, delete the account" }),
    ).toBeInTheDocument();
  });
});
