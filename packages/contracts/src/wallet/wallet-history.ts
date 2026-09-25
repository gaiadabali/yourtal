import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * One entry in the wallet's points history (docs/17 section 3: "points
 * history in plain language... not TXN_CREDIT_CAMPAIGN_4471"). YT-0504.
 *
 * Never a transaction code: the web renders each entry's words from `kind`
 * and `relatedId` through its next-intl catalogues, so the live API omits
 * `description` (4.8.a); mocks may still carry prose. `points`/`direction` keep the branded, always
 * non-negative `Points` type intact (docs/13 "Zod is the single source of
 * truth" — a signed delta would have meant a second, weaker points type) —
 * a burn is `{ points: 2_400, direction: "debit" }`, never `-2400`.
 *
 * This is what Phase U's `apps/web/features/wallet/wallet-history.ts` is
 * meant to be replaced by: that module recomputes a voucher's points cost
 * client-side from the docs/09 section 4.1 pricing formula because no
 * ledger-backed history schema existed. Once a real endpoint answers this
 * shape, the cost travels WITH the entry (`points`) rather than being
 * re-derived from a mock backing rate that has no relationship to what the
 * ledger actually recorded.
 */
export const walletHistoryEntryKindSchema = z.enum([
  "earn",
  "burn",
  "expiry",
  "reversal",
  "adjustment",
]);
export type WalletHistoryEntryKind = z.infer<typeof walletHistoryEntryKindSchema>;

const MAX_DESCRIPTION_LENGTH = 200;

export const walletHistoryEntrySchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: walletHistoryEntryKindSchema,
    occurredAt: z.iso.datetime(),
    description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH).optional(),
    points: pointsSchema,
    direction: z.enum(["credit", "debit"]),
    /**
     * An opaque pointer back to what caused this entry — a campaign id, a
     * voucher id, a support case id — informational only. Never parsed by
     * this schema's own consumers; `description` already carries everything
     * a screen shows, per docs/17 section 3.
     */
    relatedId: z.string().min(1).optional(),
  })
  .refine((entry) => entry.kind !== "earn" || entry.direction === "credit", {
    message: "an earn entry is always a credit",
    path: ["direction"],
  })
  .refine((entry) => entry.kind !== "burn" || entry.direction === "debit", {
    message: "a burn entry is always a debit",
    path: ["direction"],
  })
  .refine((entry) => entry.kind !== "expiry" || entry.direction === "debit", {
    message: "an expiry entry is always a debit",
    path: ["direction"],
  });
// reversal and adjustment may be either direction: reversing a burn credits
// the wallet back, reversing an earn debits it, and a goodwill adjustment
// (docs/14 section 5) can go either way depending on the case.

export type WalletHistoryEntry = z.infer<typeof walletHistoryEntrySchema>;
