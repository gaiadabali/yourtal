import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentForm } from "./consent-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("ConsentForm", () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it("renders three independent, un-ticked purpose controls — never one blanket agreement", () => {
    render(<ConsentForm region="AU" />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    for (const checkbox of checkboxes) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("blocks continuing until the essential (account & phone verification) purpose is accepted", async () => {
    const user = userEvent.setup();
    render(<ConsentForm region="AU" />);

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", { name: /Create my account and verify my phone/ }),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("keeps the optional purposes independent of each other and of the required one", async () => {
    const user = userEvent.setup();
    render(<ConsentForm region="AU" />);

    await user.click(screen.getByRole("checkbox", { name: /Personalise which campaigns I see/ }));
    expect(
      screen.getByRole("checkbox", { name: /Personalise which campaigns I see/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Send me marketing messages/ })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Create my account and verify my phone/ }),
    ).not.toBeChecked();
  });

  it("saves the exact choice made and advances to the phone/OTP step for the chosen region", async () => {
    const user = userEvent.setup();
    render(<ConsentForm region="ID" />);

    await user.click(
      screen.getByRole("checkbox", { name: /Buat akun saya dan verifikasi nomor HP/ }),
    );
    await user.click(screen.getByRole("checkbox", { name: /Kirimi saya pesan promosi/ }));
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(push).toHaveBeenCalledWith("/onboarding/ID/verify");
    const saved: unknown = JSON.parse(
      window.localStorage.getItem("yourtal:onboarding-consent") ?? "{}",
    );
    expect(saved).toMatchObject({ essential: true, personalize: false, marketing: true });
  });
});
