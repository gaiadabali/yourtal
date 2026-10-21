import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import { MeLinkedAppsSection } from "./me-linked-apps-section";
import { issueLinkCodeAction, unlinkAppAction } from "./me-actions";

const LINK_ID = "0b6f7a52-3c1e-4d8e-9f0a-1b2c3d4e5f60";

vi.mock("./me-actions", () => ({
  issueLinkCodeAction: vi.fn(),
  unlinkAppAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { linkId: "0b6f7a52-3c1e-4d8e-9f0a-1b2c3d4e5f60", unlinked: true },
  }),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" timeZone="Australia/Sydney" messages={{ me: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SNAP_APP = { linkId: LINK_ID, partnerId: "snap-app", linkedAt: "2026-10-20T01:00:00Z" };

describe("MeLinkedAppsSection (14.3.c)", () => {
  it("shows SnapApp as linked and unlinks it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MeLinkedAppsSection initialLinkedApps={[SNAP_APP]} isTeen={false} />);

    expect(screen.getByText("SnapApp linked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlink" }));

    expect(unlinkAppAction).toHaveBeenCalledWith(LINK_ID);
    await waitFor(() => {
      expect(screen.queryByText("SnapApp linked")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Generate code" })).toBeInTheDocument();
  });

  it("writes when a new code expires in the display language's format, not the browser's", async () => {
    vi.mocked(issueLinkCodeAction).mockResolvedValue({
      ok: true,
      data: { code: "ABC123", expiresAt: "2026-10-20T04:30:00Z" },
    });
    const user = userEvent.setup();
    renderWithIntl(<MeLinkedAppsSection initialLinkedApps={[]} isTeen={false} />);

    await user.click(screen.getByRole("button", { name: "Generate code" }));

    // 04:30 UTC is 3:30 pm in Sydney (UTC+11), the zone the provider is set to.
    expect(await screen.findByText("Expires at 3:30 pm")).toBeInTheDocument();
  });

  it("tells a teen why there is no code to generate", () => {
    renderWithIntl(<MeLinkedAppsSection initialLinkedApps={[]} isTeen />);

    expect(screen.getByRole("status")).toHaveTextContent("Teen accounts can't link other apps");
    expect(screen.queryByRole("button", { name: "Generate code" })).not.toBeInTheDocument();
  });
});
