import type { Campaign } from "@yourtal/contracts/campaign";
import { asDisplayIdr } from "@yourtal/contracts/money/format";
import type { Question } from "@yourtal/contracts/question";
import type { Voucher, VoucherStatus } from "@yourtal/contracts/voucher";

/**
 * Pure aggregation over what the mock ledger actually contains — no event
 * data, no per-user records, nothing here is extrapolated beyond a count
 * or a sum of real fields. See `report-provenance.ts` for what "measured"
 * / "configured" mean below; every exported row type carries its own
 * provenance so a caller cannot render the number without also rendering
 * how it was obtained.
 *
 * Dependency-free by design (only type-only imports plus the display-safe
 * `asDisplayIdr` from `money/format.ts`, never a value import of
 * `money.ts`'s Zod schemas) so this module stays safe to import from a
 * client leaf later without dragging Zod into the bundle
 * (docs/13b-typescript-standards.md §8).
 */

export type QuestionTypeLabel = Record<Question["type"], string>;

const QUESTION_TYPE_ORDER: readonly Question["type"][] = [
  "multiple_choice",
  "true_false",
  "likert",
  "ranked",
  "short_text",
];

export const QUESTION_TYPE_LABEL: QuestionTypeLabel = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  likert: "Likert",
  ranked: "Ranked",
  short_text: "Short text",
};

export interface QuestionTypeCount {
  type: Question["type"];
  label: string;
  count: number;
}

export interface CampaignQuestionBankRow {
  campaignId: string;
  campaignTitle: string;
  status: Campaign["status"];
  questionCount: number;
  scoringRule: Campaign["scoringRule"];
  typeCounts: QuestionTypeCount[];
  /** Always "configured" — this describes what the business set up, not a performance outcome. See report-provenance.ts. */
  provenance: "configured";
}

/**
 * What each campaign's question bank is actually configured to be — not a
 * result of anyone answering anything. There is no response/attempt
 * schema anywhere in `packages/contracts`, so accuracy and recall cannot
 * be computed here; see `reports-unavailable-metrics.ts` for that gap
 * stated explicitly rather than guessed at.
 */
export function summarizeQuestionBank(
  campaigns: readonly Campaign[],
  questionsByCampaignId: Readonly<Record<string, readonly Question[]>>,
): CampaignQuestionBankRow[] {
  return campaigns.map((campaign) => {
    const questions = questionsByCampaignId[campaign.id] ?? [];
    const counts = new Map<Question["type"], number>();
    for (const question of questions) {
      counts.set(question.type, (counts.get(question.type) ?? 0) + 1);
    }
    const typeCounts = QUESTION_TYPE_ORDER.map((type) => ({
      type,
      label: QUESTION_TYPE_LABEL[type],
      count: counts.get(type) ?? 0,
    })).filter((row) => row.count > 0);

    return {
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      status: campaign.status,
      questionCount: campaign.questionCount,
      scoringRule: campaign.scoringRule,
      typeCounts,
      provenance: "configured",
    };
  });
}

/** Sums `typeCounts` across every row given — how `reports-screen.tsx` builds the "all campaigns" view of the same chart that a single selected campaign shows on its own. */
export function aggregateQuestionTypeCounts(
  rows: readonly CampaignQuestionBankRow[],
): QuestionTypeCount[] {
  const totals = new Map<Question["type"], number>();
  for (const row of rows) {
    for (const typeCount of row.typeCounts) {
      totals.set(typeCount.type, (totals.get(typeCount.type) ?? 0) + typeCount.count);
    }
  }
  return QUESTION_TYPE_ORDER.map((type) => ({
    type,
    label: QUESTION_TYPE_LABEL[type],
    count: totals.get(type) ?? 0,
  })).filter((row) => row.count > 0);
}

export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  active: "Active",
  redeemed: "Redeemed",
  expired: "Expired",
  transferred: "Transferred",
};

/** Redeemed first — it's the number a business opens this panel to find. */
const VOUCHER_STATUS_ORDER: readonly VoucherStatus[] = [
  "redeemed",
  "active",
  "expired",
  "transferred",
];

export interface RedemptionStatusRow {
  status: VoucherStatus;
  label: string;
  count: number;
  totalFaceValueMinor: ReturnType<typeof asDisplayIdr>;
  /**
   * The CURRENCY OF THE VOUCHERS THEMSELVES (YT-0513), never the viewer's
   * region — read off the matching vouchers' own `currency` field. A
   * business's vouchers are always one region's, so this is stable per
   * row; a row with no vouchers carries whatever the ledger's own currency
   * is, and is never rendered (the panel filters zero-count rows).
   */
  currency: Voucher["currency"];
  /** Always "measured" — read directly from the voucher ledger, not derived. See report-provenance.ts for what that does and does not claim. */
  provenance: "measured";
}

export interface RedemptionLedgerSummary {
  rows: RedemptionStatusRow[];
  totalVoucherCount: number;
}

/**
 * The one genuinely real (mock-ledger) number this zone has: how many of
 * this business's own vouchers are in each status, and their total face
 * value. Deliberately NOT attributed to a source campaign — `voucherSchema`
 * carries no `campaignId`, only `listingId` and `merchantId` — see
 * `reports-unavailable-metrics.ts`'s `campaign-redemption-attribution`
 * entry for that gap stated in full.
 */
export function summarizeRedemptionLedger(vouchers: readonly Voucher[]): RedemptionLedgerSummary {
  // A business's vouchers are always one region's (docs/12 §3 region
  // isolation), so any voucher's currency stands in for the ledger's own
  // when a status group is empty and there is nothing to read it from.
  const ledgerCurrency = vouchers[0]?.currency ?? "IDR";
  const rows = VOUCHER_STATUS_ORDER.map((status) => {
    const matching = vouchers.filter((voucher) => voucher.status === status);
    const totalFaceValueMinor = matching.reduce((sum, voucher) => sum + voucher.faceValueMinor, 0);
    return {
      status,
      label: VOUCHER_STATUS_LABEL[status],
      count: matching.length,
      totalFaceValueMinor: asDisplayIdr(totalFaceValueMinor),
      currency: matching[0]?.currency ?? ledgerCurrency,
      provenance: "measured" as const,
    };
  });
  return { rows, totalVoucherCount: vouchers.length };
}
