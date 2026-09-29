import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toPoints } from "@yourtal/contracts/money";
import { GuardianGrantedPanel } from "./guardian-granted-panel";
import { revokeGuardianConsentAction } from "./guardian-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./guardian-actions", () => ({
  revokeGuardianConsentAction: vi.fn(),
}));

const revokeMock = vi.mocked(revokeGuardianConsentAction);

describe("GuardianGrantedPanel", () => {
  it("keeps the withdraw confirm closed until the trigger is clicked, by default", async () => {
    const user = userEvent.setup();
    render(
      <GuardianGrantedPanel
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
        openConfirmOnMount={false}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Withdraw approval" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Withdraw approval?")).toBeInTheDocument();
  });

  it("opens the withdraw confirm immediately when told to (?action=revoke) and submits on confirm", async () => {
    revokeMock.mockResolvedValue({ ok: true, data: { revoked: true, escrowedPoints: toPoints(0) } });
    const user = userEvent.setup();
    render(
      <GuardianGrantedPanel
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
        openConfirmOnMount
      />,
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Yes, withdraw approval" }));
    expect(revokeMock).toHaveBeenCalledWith("tok_1", "key-1");
  });
});
