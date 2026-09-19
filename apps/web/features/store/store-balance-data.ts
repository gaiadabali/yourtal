import type { Balance } from "@yourtal/contracts/balance";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * The signed-in user's wallet balance, as needed by the offer detail page
 * (YT-0421: "insufficient-balance state shows exactly how much more is
 * needed"). Server-data-only, same boundary discipline as `store-data.ts`.
 *
 * `mixedStateBalanceFixture` (8,400 available points) is used as "the
 * current user" — deliberately a mid-range, realistic balance rather than
 * zero or unlimited, so browsing the real mock catalogue naturally
 * exercises both the affordable and insufficient-balance states across
 * different listings instead of only one of them.
 */
interface StoreBalanceDataSource {
  getCurrentBalance: () => Promise<Balance>;
}

const mockDataSource: StoreBalanceDataSource = {
  getCurrentBalance: () => Promise.resolve(mixedStateBalanceFixture),
};

const liveDataSource: StoreBalanceDataSource = {
  getCurrentBalance: () =>
    Promise.reject(
      new Error("Live balance data source is not implemented yet (Phase U is mock-only)."),
    ),
};

const balanceDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** The current user's wallet balance. */
export function getCurrentBalance(): Promise<Balance> {
  return balanceDataSource.getCurrentBalance();
}
