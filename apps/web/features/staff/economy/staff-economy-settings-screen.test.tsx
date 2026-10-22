import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsScreen } from "@yourtal/contracts/staff/economy";
import enStaff from "@/messages/en-AU/staff.json";
import { StaffEconomySettingsScreen } from "./staff-economy-settings-screen";

vi.mock("./staff-economy-actions", () => ({
  approveSettingAction: vi.fn(),
  proposeSettingAction: vi.fn(),
}));

/** Looks a dotted key up in en-AU's `staff` messages, the way the page's translator does. */
function t(key: string): string {
  const found = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      enStaff,
    );
  return typeof found === "string" ? found : key;
}

function settingsWith(value: unknown): SettingsScreen {
  return {
    region: "AU",
    current: [
      {
        id: "s1",
        region: "AU",
        key: "points_identity_check",
        value,
        setBy: "founder",
        approvedBy: "plan-f126",
        effectiveFrom: "2026-10-21T00:00:00.000Z",
      },
    ],
    pending: [],
  };
}

function identityCard(appEnv: string, value: unknown) {
  render(
    <StaffEconomySettingsScreen
      t={t}
      appEnv={appEnv}
      region="AU"
      settings={settingsWith(value)}
      canPropose={false}
      currentStaffId="staff-me"
      idempotencyKey="k"
      flash={undefined}
    />,
  );
  const heading = screen.getByRole("heading", { name: "Identity check before earning" });
  // The heading sits in CardHeader, inside the Card.
  const card = heading.parentElement?.parentElement;
  if (!(card instanceof HTMLElement)) throw new Error("identity check card not found");
  return within(card);
}

describe("F126: the staff console shows the identity check's effective state", () => {
  it("says required in production even though the seeded setting is off", () => {
    const card = identityCard("production", { enabled: false });
    expect(card.getByText("Required (production)")).toBeInTheDocument();
    expect(card.getByText('{"enabled":false}')).toBeInTheDocument();
    expect(card.getByText(/Production always requires it, whatever/)).toBeInTheDocument();
  });

  it("follows the setting on staging", () => {
    expect(identityCard("staging", { enabled: true }).getByText("On")).toBeInTheDocument();
  });

  it("reads a malformed setting as off outside production", () => {
    expect(
      identityCard("staging", { enabled: "yes" }).getByText("Off: everyone earns"),
    ).toBeInTheDocument();
  });
});

describe("the settings screen's pending proposals", () => {
  const ID = "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10";
  const pending = (email: string | null | undefined): SettingsScreen => ({
    region: "AU",
    current: [],
    pending: [
      {
        id: "p1",
        kind: "setting_change",
        region: "AU",
        summary: "Daily earn cap",
        proposedBy: ID,
        ...(email === undefined ? {} : { proposedByEmail: email }),
        approvedBy: null,
        status: "pending",
        reason: null,
        createdAt: "2026-10-20T14:30:00.000Z",
        decidedAt: null,
      },
    ],
  });
  const show = (settings: SettingsScreen) =>
    render(
      <StaffEconomySettingsScreen
        t={t}
        appEnv="staging"
        region="AU"
        settings={settings}
        canPropose={false}
        currentStaffId="staff-me"
        idempotencyKey="k"
        flash={undefined}
      />,
    );

  it("names the proposer by email, not by user id", () => {
    show(pending("finance.one@example.test"));
    expect(screen.getAllByText("finance.one@example.test").length).toBeGreaterThan(0);
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });

  it("says a staff member when there is no email, never the id", () => {
    show(pending(null));
    expect(screen.getAllByText("A staff member").length).toBeGreaterThan(0);
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });
});
