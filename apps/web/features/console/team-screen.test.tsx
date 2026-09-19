import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { businessMemberSchema } from "@yourtal/contracts/business/member";
import { TeamScreen } from "./team-screen";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";
const OWNER_ID = "00000000-0000-4000-8000-000000000710";
const ADMIN_ID = "00000000-0000-4000-8000-000000000711";
const ANALYST_ID = "00000000-0000-4000-8000-000000000714";

function baseRoster() {
  return [
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: OWNER_ID,
      role: "owner",
      invitedAt: "2025-01-01T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-01T00:00:00.000Z",
    }),
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: ADMIN_ID,
      role: "admin",
      invitedAt: "2025-01-02T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-03T00:00:00.000Z",
    }),
    businessMemberSchema.parse({
      businessId: BUSINESS_ID,
      userId: ANALYST_ID,
      role: "analyst",
      invitedAt: "2025-01-04T00:00:00.000Z",
      invitedByUserId: OWNER_ID,
      joinedAt: "2025-01-05T00:00:00.000Z",
    }),
  ];
}

describe("TeamScreen", () => {
  it("renders the roster with role and status, and hides remove/change-role for the Owner row", () => {
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    const table = screen.getByRole("table");
    const ownerRow = within(table).getByText("Budi Santoso (you)").closest("tr");
    expect(ownerRow).not.toBeNull();
    expect(
      within(ownerRow as HTMLElement).queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
    expect(
      within(ownerRow as HTMLElement).getByRole("button", { name: "Transfer ownership" }),
    ).toBeInTheDocument();
  });

  it("invites a new member, who appears pending, and records it in the audit trail", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Invite member" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite a team member" });
    await user.type(within(dialog).getByLabelText("Email"), "new-hire@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("new-hire@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending invite")).toBeInTheDocument();
    expect(screen.getByText(/You invited new-hire@example.com as Marketer/)).toBeInTheDocument();
  });

  it("refuses a duplicate invite without closing the dialog", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Invite member" }));
    let dialog = await screen.findByRole("dialog", { name: "Invite a team member" });
    await user.type(within(dialog).getByLabelText("Email"), "dup@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Invite member" }));
    dialog = await screen.findByRole("dialog", { name: "Invite a team member" });
    await user.type(within(dialog).getByLabelText("Email"), "dup@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already a member or has a pending invite",
    );
    expect(screen.getByRole("dialog", { name: "Invite a team member" })).toBeInTheDocument();
  });

  it("changes a non-owner member's role", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    const analystRow = screen.getByText("Gita Ramadhani").closest("tr") as HTMLElement;
    await user.click(within(analystRow).getByRole("button", { name: "Change role" }));
    const dialog = await screen.findByRole("dialog", { name: /Change Gita Ramadhani.?s role/ });
    await user.selectOptions(within(dialog).getByLabelText("New role"), "finance");
    await user.click(within(dialog).getByRole("button", { name: "Save role" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/role changed from Analyst to Finance/)).toBeInTheDocument();
  });

  it("removes a non-owner member after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    const analystRow = screen.getByText("Gita Ramadhani").closest("tr") as HTMLElement;
    await user.click(within(analystRow).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Gita Ramadhani?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Gita Ramadhani")).not.toBeInTheDocument();
    expect(screen.getByText(/was removed from the team/)).toBeInTheDocument();
  });

  it("warns an Admin they will lose Team access before demoting themselves, then locks them out on confirm", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={ADMIN_ID}
        initialViewerRole="admin"
        initialRoster={baseRoster()}
      />,
    );

    const ownRow = screen.getByText("Citra Wulandari (you)").closest("tr") as HTMLElement;
    await user.click(within(ownRow).getByRole("button", { name: "Change role" }));
    const dialog = await screen.findByRole("dialog", { name: /Change Citra Wulandari.?s role/ });
    await user.selectOptions(within(dialog).getByLabelText("New role"), "analyst");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "You will lose access to Team management",
    );

    await user.click(within(dialog).getByRole("button", { name: "Save role" }));

    expect(await screen.findByText(/You.?ve left Kopi Kenangan.?s team/)).toBeInTheDocument();
  });

  it("removing yourself shows the self-removal warning and locks you out on confirm", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={ADMIN_ID}
        initialViewerRole="admin"
        initialRoster={baseRoster()}
      />,
    );

    const ownRow = screen.getByText("Citra Wulandari (you)").closest("tr") as HTMLElement;
    await user.click(within(ownRow).getByRole("button", { name: "Remove me" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove yourself from this team?" });
    expect(
      within(dialog).getByText(/You will lose access to this business console immediately/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove me" }));

    expect(await screen.findByText(/You.?ve left Kopi Kenangan.?s team/)).toBeInTheDocument();
  });

  it("transfers ownership through re-authentication and successor selection", async () => {
    const user = userEvent.setup();
    render(
      <TeamScreen
        businessId={BUSINESS_ID}
        businessDisplayName="Kopi Kenangan"
        currentUserId={OWNER_ID}
        initialViewerRole="owner"
        initialRoster={baseRoster()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Transfer ownership" }));
    let dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
    await user.type(within(dialog).getByLabelText("Password"), "correct horse battery staple");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    dialog = await screen.findByRole("dialog", { name: "Transfer ownership" });
    await user.selectOptions(within(dialog).getByLabelText("New Owner"), ADMIN_ID);
    await user.click(within(dialog).getByRole("button", { name: "Transfer ownership" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/You transferred ownership to Citra Wulandari/)).toBeInTheDocument();

    // `currentUserId` (Budi) does not change — the component tracks the viewer's ROLE changing, not their identity.
    const formerOwnerRow = screen.getByText("Budi Santoso (you)").closest("tr") as HTMLElement;
    expect(within(formerOwnerRow).getByText("Admin")).toBeInTheDocument();
    const newOwnerRow = screen.getByText("Citra Wulandari").closest("tr") as HTMLElement;
    expect(within(newOwnerRow).getByText("Owner")).toBeInTheDocument();
    // Budi is no longer Owner, so the Transfer button disappears from Citra's (now-Owner) row for this viewer.
    expect(
      within(newOwnerRow).queryByRole("button", { name: "Transfer ownership" }),
    ).not.toBeInTheDocument();
  });
});
