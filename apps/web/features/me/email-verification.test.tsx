import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import idID from "@/messages/id-ID/me.json";
import { EmailVerificationReminder, MeEmailVerificationSection } from "./email-verification";

const { requestEmailVerificationAction } = vi.hoisted(() => ({
  requestEmailVerificationAction: vi.fn(),
}));
vi.mock("@/features/player/identity-check-actions", () => ({ requestEmailVerificationAction }));

function renderWithIntl(ui: React.ReactElement, locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ me: locale === "en-AU" ? enAU : idID }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  requestEmailVerificationAction.mockReset();
});

describe("MeEmailVerificationSection (F126)", () => {
  it("says the email is not verified and offers to send the link again", async () => {
    requestEmailVerificationAction.mockResolvedValue({ ok: true, data: { requested: true } });
    const user = userEvent.setup();
    renderWithIntl(<MeEmailVerificationSection email="mei@example.com" verified={false} />);

    expect(screen.getByText("mei@example.com")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send the link again" }));

    expect(requestEmailVerificationAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/We sent a new link to mei@example.com/)).toBeInTheDocument();
  });

  it("shows a failed send and keeps the button", async () => {
    requestEmailVerificationAction.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const user = userEvent.setup();
    renderWithIntl(<MeEmailVerificationSection email="mei@example.com" verified={false} />);

    await user.click(screen.getByRole("button", { name: "Send the link again" }));

    expect(await screen.findByText(/couldn't be sent/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send the link again" })).toBeInTheDocument();
  });

  it("shows a verified email without a resend button", () => {
    renderWithIntl(<MeEmailVerificationSection email="mei@example.com" verified />);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("speaks Bahasa Indonesia", () => {
    renderWithIntl(
      <MeEmailVerificationSection email="mei@example.com" verified={false} />,
      "id-ID",
    );

    expect(screen.getByText("Belum terverifikasi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kirim tautan lagi" })).toBeInTheDocument();
  });
});

describe("EmailVerificationReminder", () => {
  it("reminds a new account to verify and can send the link again", async () => {
    requestEmailVerificationAction.mockResolvedValue({ ok: true, data: { requested: true } });
    const user = userEvent.setup();
    renderWithIntl(<EmailVerificationReminder email="mei@example.com" />);

    expect(screen.getByText("Verify your email to start earning points")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send the link again" }));

    expect(await screen.findByText(/We sent a new link/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
