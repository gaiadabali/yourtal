import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ReceiptProgrammeRow } from "@yourtal/contracts/staff/economy";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { StaffEconomyReceiptsScreen } from "./staff-economy-receipts-screen";

const translator = (locale: "en-AU" | "id-ID") =>
  createTranslator({
    locale,
    messages: { staff: locale === "en-AU" ? enStaff : idStaff },
    namespace: "staff",
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

const programme = (overrides: Partial<ReceiptProgrammeRow> = {}): ReceiptProgrammeRow =>
  ({
    partnerId: "snap-app",
    funderBusinessId: "11111111-1111-4111-8111-111111111111",
    funderName: "Snap App Pty Ltd",
    pointsPerReceipt: 1,
    packages: [
      {
        allocationId: "pkg-1",
        totalPoints: 1_000,
        remainingPoints: 412,
        boughtAt: "2026-10-20T03:00:00.000Z",
      },
    ],
    paidPoints: 588,
    paidLast7Days: 120,
    topEarners: [
      { userId: "user-aaa", points: 40, receipts: 40 },
      { userId: "user-bbb", points: 12, receipts: 12 },
    ],
    ...overrides,
  }) as ReceiptProgrammeRow;

function show(rows: ReceiptProgrammeRow[], locale: "en-AU" | "id-ID" = "en-AU") {
  return render(<StaffEconomyReceiptsScreen t={translator(locale)} programmes={rows} />);
}

describe("the receipt programmes section", () => {
  it("shows the funder, the package left, what was paid and the top earners", () => {
    show([programme()]);
    expect(screen.getByRole("heading", { name: "Partner: snap-app" })).toBeInTheDocument();
    expect(screen.getByText("Snap App Pty Ltd")).toBeInTheDocument();
    expect(screen.getByText("1 points")).toBeInTheDocument();
    expect(screen.getByText("588 points")).toBeInTheDocument();
    expect(screen.getByText("120 points")).toBeInTheDocument();

    const packages = screen.getByRole("table", { name: "Receipt packages" });
    expect(within(packages).getByText("412 of 1,000 points left")).toBeInTheDocument();
    expect(within(packages).getByText("2026-10-20")).toBeInTheDocument();

    const earners = screen.getByRole("table", { name: "Top earners, last 30 days" });
    expect(within(earners).getByText("user-aaa")).toBeInTheDocument();
    expect(within(earners).getByText("40 points")).toBeInTheDocument();
    expect(within(earners).getByText("user-bbb")).toBeInTheDocument();
  });

  it("says so when nothing is bought or earned yet, and when there is no funder at all", () => {
    const { unmount } = show([programme({ packages: [], topEarners: [], funderName: "" })]);
    expect(screen.getByText(/No receipt package has been bought yet/)).toBeInTheDocument();
    expect(screen.getByText("No receipts paid in the last 30 days.")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    unmount();

    show([]);
    expect(screen.getByText("No receipt programmes in this region")).toBeInTheDocument();
  });

  it("reads in Indonesian too", () => {
    show([programme()], "id-ID");
    expect(screen.getByRole("heading", { name: "Mitra: snap-app" })).toBeInTheDocument();
    const packages = screen.getByRole("table", { name: "Paket struk" });
    expect(within(packages).getByText("Sisa 412 dari 1.000 poin")).toBeInTheDocument();
  });

  it("never names the backing rate", () => {
    const { container } = show([programme()]);
    expect(container.textContent?.toLowerCase()).not.toMatch(/backing|micros|\bb\b/);
    for (const messages of [enStaff.economy.receipts, idStaff.economy.receipts]) {
      expect(JSON.stringify(messages).toLowerCase()).not.toMatch(/backing|micros|kurs/);
    }
  });
});
