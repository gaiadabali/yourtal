import { describe, expect, it } from "vitest";
import { balanceSchema } from "./balance";
import {
  generateBalance,
  generateBalances,
  mixedStateBalanceFixture,
  mockBalances,
  zeroBalanceFixture,
} from "./balance.mock";

const validBalance = {
  userId: "11111111-1111-4111-8111-111111111111",
  availablePoints: 8_400,
  pendingPoints: 1_200,
  pendingUnlockAt: "2026-09-22T00:00:00.000Z",
  expiringPoints: 500,
  expiringAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-19T09:00:00.000Z",
};

describe("balanceSchema", () => {
  it("round-trips a valid balance", () => {
    const parsed = balanceSchema.parse(validBalance);
    expect(parsed).toMatchObject({ availablePoints: 8_400 });
  });

  it("round-trips a balance with nothing pending or expiring", () => {
    const clean = {
      ...validBalance,
      pendingPoints: 0,
      pendingUnlockAt: null,
      expiringPoints: 0,
      expiringAt: null,
    };
    expect(balanceSchema.safeParse(clean).success).toBe(true);
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "negative available points", overrides: { availablePoints: -1 } },
    {
      name: "pendingPoints positive with null pendingUnlockAt",
      overrides: { pendingUnlockAt: null },
    },
    { name: "pendingPoints zero with non-null pendingUnlockAt", overrides: { pendingPoints: 0 } },
    { name: "expiringPoints positive with null expiringAt", overrides: { expiringAt: null } },
    { name: "expiringPoints zero with non-null expiringAt", overrides: { expiringPoints: 0 } },
    { name: "expiringPoints greater than availablePoints", overrides: { expiringPoints: 9_000 } },
    { name: "non-datetime updatedAt", overrides: { updatedAt: "just now" } },
    { name: "non-uuid userId", overrides: { userId: "not-a-uuid" } },
    { name: "fractional points", overrides: { availablePoints: 8_400.5 } },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validBalance, ...overrides };
    expect(balanceSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateBalance determinism", () => {
  it("produces byte-identical output for the same seed and reference instant", () => {
    const now = new Date("2026-09-19T09:00:00.000Z");
    const first = generateBalance({ seed: 11, now });
    const second = generateBalance({ seed: 11, now });
    expect(first).toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    expect(generateBalances(10, 6_000)).toStrictEqual(mockBalances);
  });
});

describe("awkward fixtures", () => {
  it("the zero-balance fixture has nothing available, pending or expiring", () => {
    expect(zeroBalanceFixture.availablePoints).toBe(0);
    expect(zeroBalanceFixture.pendingPoints).toBe(0);
    expect(zeroBalanceFixture.expiringPoints).toBe(0);
  });

  it("the mixed-state fixture has available, pending and expiring points simultaneously", () => {
    expect(mixedStateBalanceFixture.availablePoints).toBeGreaterThan(0);
    expect(mixedStateBalanceFixture.pendingPoints).toBeGreaterThan(0);
    expect(mixedStateBalanceFixture.expiringPoints).toBeGreaterThan(0);
  });
});
