import type { Campaign } from "@yourtal/contracts/campaign";
import type { Voucher } from "@yourtal/contracts/voucher";
import { pointsPriceFromSettlement } from "@yourtal/contracts/money";
import { formatPoints } from "@yourtal/contracts/money/format";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";
import { MOCK_BACKING_RATE_IDR_SEN_PER_POINT } from "@yourtal/contracts/money/mock-backing-rate";

/**
 * Wallet history in plain language (YT-0423: "never transaction codes").
 * Every entry reads like something that happened — e.g. "Menyelesaikan
 * video Kopi Kenangan — dapat 2.400 poin" — never a ledger row like
 * `TXN_CREDIT_CAMPAIGN_4471`.
 *
 * Server-only (imports `@yourtal/contracts/money`, which pulls Zod — see
 * docs/13b-typescript-standards.md §8 rule 1). Only `wallet-data.ts` calls
 * this; no client leaf imports it.
 *
 * Every field used below is real: `merchantName`, `rewardPoints` and
 * `publishedAt` come straight off `Campaign`; `merchantName`, `faceValueIdr`
 * and `issuedAt` off `Voucher`. Nothing is invented except the *points
 * cost* of a voucher redemption, which no contract carries yet (there is
 * no ledger/history schema in packages/contracts today) — that number is
 * derived from the documented pricing formula
 * (docs/09-points-economy-and-redemption.md §4.1: `points_price = S / B`)
 * at a fixed mock backing rate, not made up. When a real wallet-history
 * endpoint exists, `wallet-data.ts` is the only place that needs to change
 * to consume it instead of this module.
 */

export interface WalletHistoryEntry {
  id: string;
  occurredAt: string;
  description: string;
  /** Positive = points earned, negative = points spent. Never a bare code. */
  pointsDelta: number;
}

function earnedEntry(campaign: Campaign, locale: SupportedLocale): WalletHistoryEntry {
  const t = getWalletTranslator(locale);
  return {
    id: `earn-${campaign.id}`,
    occurredAt: campaign.publishedAt,
    description: t("history.earned", {
      merchantName: campaign.merchantName,
      amount: formatPoints(campaign.rewardPoints, locale),
    }),
    pointsDelta: campaign.rewardPoints,
  };
}

function spentEntry(voucher: Voucher, locale: SupportedLocale): WalletHistoryEntry {
  const cost = pointsPriceFromSettlement(voucher.faceValueIdr, MOCK_BACKING_RATE_IDR_SEN_PER_POINT);
  const t = getWalletTranslator(locale);
  // `cost` is the branded `Points` type; negating it directly through a
  // brand is what @typescript-eslint/no-unsafe-unary-minus objects to.
  // `Number(cost)` reads it back out as a plain number first.
  return {
    id: `spend-${voucher.id}`,
    occurredAt: voucher.issuedAt,
    description: t("history.spent", {
      merchantName: voucher.merchantName,
      amount: formatPoints(cost, locale),
    }),
    pointsDelta: -Number(cost),
  };
}

/**
 * Builds and time-sorts (newest first) the wallet's point history from its
 * vouchers and a sample of completed campaigns.
 *
 * YT-0405: `locale` defaults to `id-ID` so existing callers are unaffected.
 */
export function buildWalletHistory(
  vouchers: Voucher[],
  earnedFromCampaigns: Campaign[],
  locale: SupportedLocale = "id-ID",
): WalletHistoryEntry[] {
  const entries = [
    ...earnedFromCampaigns.map((campaign) => earnedEntry(campaign, locale)),
    ...vouchers.map((voucher) => spentEntry(voucher, locale)),
  ];
  return entries.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
