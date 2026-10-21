import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { RegionSetting } from "@yourtal/contracts/ledger-internal/settings";
import { toPoints } from "@yourtal/contracts/money";
import { buildReceiptProgrammes } from "./receipt-programmes";
import type { ReceiptProgrammeDeps } from "./receipt-programmes";

const FUNDER_A = "11111111-1111-4111-8111-111111111111";
const FUNDER_B = "22222222-2222-4222-8222-222222222222";

const setting = (
  key: string,
  value: unknown,
  region: "AU" | "ID" = "AU",
  approvedBy: string | null = "staff-2",
): RegionSetting => ({
  id: key,
  region,
  key,
  value,
  setBy: "staff-1",
  approvedBy,
  effectiveFrom: null,
});

const allocation = (id: string, programme: "receipts" | null, total: number, left: number) => ({
  allocationId: id,
  businessId: FUNDER_A,
  region: "AU" as const,
  funderType: "partner" as const,
  totalPoints: toPoints(total),
  remainingPoints: toPoints(left),
  programme,
  createdAt: `2026-10-${id.endsWith("2") ? "20" : "10"}T00:00:00.000Z`,
});

function deps(settings: RegionSetting[], overrides: Partial<ReceiptProgrammeDeps["ledger"]> = {}) {
  const receiptProgrammeStats = vi.fn(() =>
    okAsync({ paidPoints: toPoints(7), paidLast7Days: toPoints(2), topEarners: [] }),
  );
  const ledger = {
    getSettings: () => Promise.resolve(settings),
    listAllocations: () =>
      okAsync([
        allocation("pkg-2", "receipts", 1_000, 900),
        allocation("campaign", null, 500, 500),
        allocation("pkg-1", "receipts", 1_000, 0),
      ]),
    receiptProgrammeStats,
    ...overrides,
  } as unknown as ReceiptProgrammeDeps["ledger"];
  return {
    value: { ledger, funderName: () => Promise.resolve("Funder Pty Ltd") },
    receiptProgrammeStats,
  };
}

describe("buildReceiptProgrammes", () => {
  it("is empty when no partner has an approved funder in the region", async () => {
    const { value } = deps([
      setting("receipt_funder.snap-app", { businessId: FUNDER_A }, "ID"),
      setting("receipt_funder.pending", { businessId: FUNDER_A }, "AU", null),
      setting("receipt_funder.broken", { business: "x" }),
      setting("receipt_points", 1),
    ]);
    expect((await buildReceiptProgrammes(value, "AU"))._unsafeUnwrap()).toEqual([]);
  });

  it("lists the funder's receipt packages oldest first, never a campaign allocation, and asks for stats on those only", async () => {
    const { value, receiptProgrammeStats } = deps([
      setting("receipt_funder.snap-app", { businessId: FUNDER_A }),
      setting("receipt_points", 10),
    ]);
    const [row] = (await buildReceiptProgrammes(value, "AU"))._unsafeUnwrap();
    expect(row).toMatchObject({
      partnerId: "snap-app",
      funderBusinessId: FUNDER_A,
      funderName: "Funder Pty Ltd",
      pointsPerReceipt: 10,
      paidPoints: 7,
      paidLast7Days: 2,
    });
    expect(row?.packages.map((pkg) => pkg.allocationId)).toEqual(["pkg-1", "pkg-2"]);
    expect(row?.packages[1]).toEqual({
      allocationId: "pkg-2",
      totalPoints: 1_000,
      remainingPoints: 900,
      boughtAt: "2026-10-20T00:00:00.000Z",
    });
    expect(receiptProgrammeStats).toHaveBeenCalledWith({
      region: "AU",
      allocationIds: ["pkg-1", "pkg-2"],
    });
  });

  it("lists partners by id and defaults to one point a receipt", async () => {
    const { value } = deps([
      setting("receipt_funder.zeta", { businessId: FUNDER_B }),
      setting("receipt_funder.alpha", { businessId: FUNDER_A }),
    ]);
    const rows = (await buildReceiptProgrammes(value, "AU"))._unsafeUnwrap();
    expect(rows.map((row) => row.partnerId)).toEqual(["alpha", "zeta"]);
    expect(rows.every((row) => row.pointsPerReceipt === 1)).toBe(true);
  });

  it("passes a ledger refusal on", async () => {
    const { value } = deps([setting("receipt_funder.snap-app", { businessId: FUNDER_A })], {
      receiptProgrammeStats: () => errAsync(ledgerError("refused", "no")),
    });
    expect((await buildReceiptProgrammes(value, "AU"))._unsafeUnwrapErr().code).toBe("refused");
  });
});
