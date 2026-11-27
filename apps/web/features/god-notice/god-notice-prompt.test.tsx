import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/godNotice.json";
import { GodNoticePrompt } from "./god-notice-prompt";
import { decideGodNoticeAction } from "./god-notice-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./god-notice-actions", () => ({ decideGodNoticeAction: vi.fn() }));

const decideMock = vi.mocked(decideGodNoticeAction);

const TICK_TEXT =
  "I have read and accept the GOD Group Privacy Notice. I understand that my activity in YourTal, SnapApp and Free Tax Returns is combined into one profile, and that businesses receive reports about groups of people, never about me.";

function renderPrompt() {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ godNotice: enAU }}>
      <GodNoticePrompt noticeVersion="1.0" />
    </NextIntlClientProvider>,
  );
}

describe("GodNoticePrompt (9.1.b, an existing account's next sign-in)", () => {
  it("shows the founder's wording, unticked, with the notice linked", () => {
    renderPrompt();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    expect(checkbox.closest("label")).toHaveTextContent(TICK_TEXT);
    expect(screen.getByRole("link", { name: "GOD Group Privacy Notice" })).toHaveAttribute(
      "href",
      "https://god.gaiada.com/privacy-notice/",
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("Not now records declined without needing the tick", async () => {
    decideMock.mockResolvedValue({ ok: true, data: {} as never });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(decideMock).toHaveBeenCalledWith("declined", "1.0");
    expect(refresh).toHaveBeenCalled();
  });

  it("Accept needs the tick, then records accepted", async () => {
    decideMock.mockResolvedValue({ ok: true, data: {} as never });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(decideMock).toHaveBeenCalledWith("accepted", "1.0");
  });

  it("stays open and says so when saving fails", async () => {
    decideMock.mockResolvedValue({ ok: false, error: { kind: "network", message: "boom" } });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
