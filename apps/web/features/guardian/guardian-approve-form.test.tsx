import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuardianApproveForm } from "./guardian-approve-form";
import { approveGuardianConsentAction } from "./guardian-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./guardian-actions", () => ({
  approveGuardianConsentAction: vi.fn(),
}));

const approveMock = vi.mocked(approveGuardianConsentAction);

describe("GuardianApproveForm", () => {
  it("keeps Approve disabled until the confirmation checkbox is ticked, then submits", async () => {
    approveMock.mockResolvedValue({ ok: true, data: { approved: true } });
    const user = userEvent.setup();
    render(
      <GuardianApproveForm
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
      />,
    );

    const approveButton = screen.getByRole("button", { name: "Approve" });
    expect(approveButton).toBeDisabled();

    expect(
      screen.getByText("I am 18 or over and the parent or guardian of Alex."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    expect(approveButton).toBeEnabled();

    await user.click(approveButton);
    expect(approveMock).toHaveBeenCalledWith("tok_1", "key-1");
  });

  it("shows a translated error and leaves the form usable when the API call fails", async () => {
    approveMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "boom" },
    });
    const user = userEvent.setup();
    render(
      <GuardianApproveForm
        token="tok_1"
        displayName="Alex"
        locale="en-AU"
        idempotencyKey="key-1"
      />,
    );

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText("YourTal couldn't be reached. Check your connection and try again."),
    ).toBeInTheDocument();
  });

  it("renders the id-ID catalogue when the teen's own locale is id-ID", () => {
    render(
      <GuardianApproveForm
        token="tok_1"
        displayName="Sari"
        locale="id-ID"
        idempotencyKey="key-1"
      />,
    );
    expect(screen.getByRole("button", { name: "Setujui" })).toBeInTheDocument();
  });
});
