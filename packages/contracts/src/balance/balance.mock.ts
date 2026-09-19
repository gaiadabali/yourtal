import type { Balance } from "./balance";
import { balanceSchema } from "./balance";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { toPoints } from "../money/money";

export interface GenerateBalanceParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic wallet balance for the given seed. */
export function generateBalance(params: GenerateBalanceParams): Balance {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const availablePoints = faker.number.int({ min: 0, max: 25_000 });
  const hasPending = faker.datatype.boolean({ probability: 0.4 });
  const hasExpiring = availablePoints > 0 && faker.datatype.boolean({ probability: 0.3 });
  const pendingPoints = hasPending ? faker.number.int({ min: 50, max: 3_000 }) : 0;
  const expiringPoints = hasExpiring ? faker.number.int({ min: 1, max: availablePoints }) : 0;

  return balanceSchema.parse({
    userId: faker.string.uuid(),
    availablePoints: toPoints(availablePoints),
    pendingPoints: toPoints(pendingPoints),
    pendingUnlockAt: hasPending
      ? toIsoString(addDays(now, faker.number.int({ min: 1, max: 14 })))
      : null,
    expiringPoints: toPoints(expiringPoints),
    expiringAt: hasExpiring
      ? toIsoString(addDays(now, faker.number.int({ min: 1, max: 30 })))
      : null,
    updatedAt: toIsoString(now),
  });
}

/** Generates `count` deterministic balances from a base seed. */
export function generateBalances(count: number, baseSeed: number, now?: Date): Balance[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateBalance({ seed: baseSeed + index, now }),
  );
}

/** A wallet with a zero balance — the "you have nothing yet, go earn" empty state. */
export const zeroBalanceFixture: Balance = balanceSchema.parse({
  userId: "00000000-0000-4000-8000-000000000801",
  availablePoints: toPoints(0),
  pendingPoints: toPoints(0),
  pendingUnlockAt: null,
  expiringPoints: toPoints(0),
  expiringAt: null,
  updatedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

/** A wallet with a healthy balance, pending holdback funds and points about to expire, all at once. */
export const mixedStateBalanceFixture: Balance = balanceSchema.parse({
  userId: "00000000-0000-4000-8000-000000000802",
  availablePoints: toPoints(8_400),
  pendingPoints: toPoints(1_200),
  pendingUnlockAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 3)),
  expiringPoints: toPoints(500),
  expiringAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 5)),
  updatedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

export const mockBalances: Balance[] = generateBalances(10, 6_000);
