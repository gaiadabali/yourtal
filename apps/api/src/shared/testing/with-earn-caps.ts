import type { Region } from "@yourtal/contracts/region";
import type { LedgerInternalClient } from "../ledger-client/ledger-internal-client";

/**
 * Runs `body` with a region's ADULT daily and monthly earn caps set to
 * `caps`, then restores whatever was in force (as a fresh approved row, so
 * the history stays append-only). For a test that needs a cap it can reach
 * with a few small grants, or a single grant far larger than F12's real caps
 * (e.g. one only the marketing fund can refuse).
 * Both ledgers read the caps on every grant with no cache, so the change is
 * live at once; test files run serially (vitest `fileParallelism: false`), so
 * nothing else sees the raised value.
 */
export async function withEarnCaps<T>(
  client: Pick<LedgerInternalClient, "getSettings" | "proposeSetting" | "approveSetting">,
  region: Region,
  caps: { readonly daily: number; readonly monthly: number },
  body: () => PromiseLike<T>,
): Promise<T> {
  const keys = ["daily_earn_cap", "monthly_earn_cap"] as const;
  const set = async (values: Record<(typeof keys)[number], unknown>): Promise<void> => {
    for (const key of keys) {
      const proposed = await client.proposeSetting({
        region,
        key,
        value: values[key],
        proposedBy: "staff-1",
      });
      await client.approveSetting({ id: proposed.id, approvedBy: "staff-2" });
    }
  };

  const current = await client.getSettings(region);
  const original = {
    daily_earn_cap: current.find((s) => s.key === "daily_earn_cap")?.value,
    monthly_earn_cap: current.find((s) => s.key === "monthly_earn_cap")?.value,
  };
  if (
    typeof original.daily_earn_cap !== "number" ||
    typeof original.monthly_earn_cap !== "number"
  ) {
    throw new Error(`${region} has no earn caps in force to restore`);
  }

  await set({ daily_earn_cap: caps.daily, monthly_earn_cap: caps.monthly });
  try {
    return await body();
  } finally {
    await set(original);
  }
}

/** Caps no fixture grant reaches, for a test that tops a user up past one day's earn cap. */
export const HIGH_EARN_CAPS = { daily: 10_000_000_000, monthly: 10_000_000_000 } as const;
