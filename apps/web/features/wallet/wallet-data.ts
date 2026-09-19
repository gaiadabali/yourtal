import type { Balance } from "@yourtal/contracts/balance";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import type { Voucher } from "@yourtal/contracts/voucher";
import {
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
  mockVouchers,
} from "@yourtal/contracts/voucher/mock";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import type { WalletHistoryEntry } from "./wallet-history";
import { buildWalletHistory } from "./wallet-history";

/**
 * The Wallet's single data-access seam (docs/tasks/phase-u-ui.md preamble:
 * "one switch flips every screen between mock and live"), same shape as
 * apps/web/features/campaign/campaign-data.ts. Server-data-only per
 * docs/13b-typescript-standards.md §8: only `page.tsx` Server Components in
 * apps/web/app/(app)/wallet/** import this module — no "use client" file in
 * this feature does.
 *
 * The awkward voucher fixtures (`expiredVoucherFixture`,
 * `expiringWithinHourVoucherFixture`) are folded into the catalogue rather
 * than kept test-only, so the real /wallet page exercises the archived and
 * "about to lose it" states directly, per the brief: "use them." The
 * balance fixtures cannot both be shown at once (a wallet has exactly one
 * balance) — `mixedStateBalanceFixture` is used here because it exercises
 * every balance-card branch (available, pending, expiring) simultaneously;
 * `zeroBalanceFixture` is exercised directly by wallet-empty-state's own
 * test instead.
 */
const HISTORY_CAMPAIGN_SAMPLE_SIZE = 6;

const mockVoucherCatalogue: Voucher[] = [
  ...mockVouchers,
  expiredVoucherFixture,
  expiringWithinHourVoucherFixture,
];

interface WalletDataSource {
  getBalance: () => Promise<Balance>;
  listVouchers: () => Promise<Voucher[]>;
  getVoucher: (voucherId: string) => Promise<Voucher | undefined>;
  listHistory: () => Promise<WalletHistoryEntry[]>;
}

const mockDataSource: WalletDataSource = {
  getBalance: () => Promise.resolve(mixedStateBalanceFixture),
  listVouchers: () => Promise.resolve(mockVoucherCatalogue),
  getVoucher: (voucherId) =>
    Promise.resolve(mockVoucherCatalogue.find((voucher) => voucher.id === voucherId)),
  listHistory: () =>
    Promise.resolve(
      buildWalletHistory(
        mockVoucherCatalogue,
        mockCampaigns.slice(0, HISTORY_CAMPAIGN_SAMPLE_SIZE),
      ),
    ),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live wallet data source is not implemented yet (Phase U is mock-only).";

/**
 * Fails loudly and specifically rather than silently falling back to mock
 * data under a "live" flag — see campaign-data.ts for the same reasoning.
 */
const liveDataSource: WalletDataSource = {
  getBalance: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listVouchers: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  getVoucher: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listHistory: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const walletDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

/** The signed-in user's wallet balance. */
export function getWalletBalance(): Promise<Balance> {
  return walletDataSource.getBalance();
}

/** Every voucher the user holds, active and archived alike. */
export function listWalletVouchers(): Promise<Voucher[]> {
  return walletDataSource.listVouchers();
}

/** A single voucher for the detail screen, or `undefined` if no such voucher exists. */
export function getWalletVoucher(voucherId: string): Promise<Voucher | undefined> {
  return walletDataSource.getVoucher(voucherId);
}

/** Points history, newest first, in plain language. */
export function listWalletHistory(): Promise<WalletHistoryEntry[]> {
  return walletDataSource.listHistory();
}
