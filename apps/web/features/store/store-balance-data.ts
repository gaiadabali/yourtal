import "server-only";

import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { getWalletBalance } from "@/features/wallet/wallet-data";

/**
 * The signed-in user's real wallet balance (11.6.b, replacing Phase U's
 * `mixedStateBalanceFixture`). Delegates to `features/wallet`'s own
 * `getWalletBalance` — the store's balance IS the wallet's balance, and two
 * independent fetches of `GET /api/wallet` would just be two chances to
 * drift.
 *
 * Throws on a non-ok result, same convention as `store-data.ts`'s
 * `getListing` for a non-404 failure — the nearest `error.tsx` (offer page,
 * redeem page) renders it.
 */
export async function getCurrentBalance(): Promise<WalletSummary> {
  const result = await getWalletBalance();
  if (result.ok) return result.data;
  throw new Error(`GET /api/wallet failed: ${result.error.message}`);
}
