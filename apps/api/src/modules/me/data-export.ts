import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { LedgerHistoryEntry } from "@yourtal/contracts/ledger-internal/wallet";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import { publicVoucherStatusOf } from "@yourtal/contracts/voucher/voucher-lifecycle";
import type { ExportAccountRow, ExportWatchSessionRow } from "./persistence/data-export.reader";

type WalletEntryKind = "earn" | "burn" | "expiry" | "reversal" | "adjustment";

/**
 * The account, wallet, voucher and watch sections of `GET /api/me/data-export`
 * (13.3.d). Pure: the controller reads, this shapes. It names fields one by
 * one so nothing internal rides along: no ledger `externalRef`, no voucher
 * code or saga id, no hold id, no backing rate, no ledger account.
 */
export interface DataExportSections {
  readonly account: {
    readonly email: string | null;
    readonly displayName: string;
    readonly region: string;
    readonly locale: string;
    readonly timezone: string;
    readonly createdAt: string;
    readonly ageBand: "teen" | "adult";
    readonly parentConsentStatus: string;
  } | null;
  readonly wallet: readonly {
    readonly kind: WalletEntryKind;
    readonly direction: "credit" | "debit";
    readonly points: number;
    readonly at: string;
    readonly campaignId: string | null;
    readonly listingId: string | null;
    readonly voucherId: string | null;
  }[];
  readonly vouchers: readonly {
    readonly voucherId: string;
    readonly title: string;
    readonly brand: string;
    readonly status: string | null;
    readonly currency: string;
    readonly faceValueMinor: number;
    readonly remainingValueMinor: number;
    /** The burn that paid for it, when the ledger history still holds one. */
    readonly issuedAt: string | null;
    readonly expiresAt: string;
  }[];
  readonly watchSessions: readonly {
    readonly sessionId: string;
    readonly campaignId: string;
    readonly campaignTitle: string | null;
    readonly state: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly pointsEarned: number;
  }[];
}

const ENTRY_KIND: Record<
  LedgerHistoryEntry["kind"],
  { kind: WalletEntryKind; direction: "credit" | "debit" }
> = {
  grant: { kind: "earn", direction: "credit" },
  burn: { kind: "burn", direction: "debit" },
  expiry: { kind: "expiry", direction: "debit" },
  reinstatement: { kind: "reversal", direction: "credit" },
  escrow: { kind: "adjustment", direction: "debit" },
  escrow_release: { kind: "adjustment", direction: "credit" },
};

const WATCH_GRANT_PREFIX = "watch-grant:";

export function buildDataExportSections(input: {
  readonly now: Date;
  readonly account: ExportAccountRow | null;
  readonly history: readonly LedgerHistoryEntry[];
  readonly vouchers: readonly WalletVoucherRow[];
  readonly sessions: readonly ExportWatchSessionRow[];
}): DataExportSections {
  const { account, history } = input;

  const burnAtByVoucher = new Map<string, string>();
  const earnedBySession = new Map<string, number>();
  for (const entry of history) {
    if (entry.kind === "burn" && entry.voucherId !== null) {
      burnAtByVoucher.set(entry.voucherId, entry.at);
    }
    // The watch grant's idempotency key is `watch-grant:<sessionId>`.
    if (entry.kind === "grant" && entry.externalRef.startsWith(WATCH_GRANT_PREFIX)) {
      const sessionId = entry.externalRef.slice(WATCH_GRANT_PREFIX.length);
      earnedBySession.set(sessionId, (earnedBySession.get(sessionId) ?? 0) + entry.points);
    }
  }

  return {
    account:
      account === null
        ? null
        : {
            email: account.email,
            displayName: account.displayName,
            region: account.region,
            locale: account.displayLocale,
            timezone: account.timezone,
            createdAt: account.createdAt.toISOString(),
            ageBand: ageBandFrom(ageYearsFrom(account.dateOfBirth, input.now)),
            parentConsentStatus: account.parentConsentStatus,
          },
    wallet: history.map((entry) => ({
      ...ENTRY_KIND[entry.kind],
      points: entry.points,
      at: entry.at,
      campaignId: entry.campaignId,
      listingId: entry.listingId,
      voucherId: entry.voucherId,
    })),
    vouchers: input.vouchers.map((row) => ({
      voucherId: row.voucherId,
      title: row.title,
      brand: row.merchantName,
      status: publicVoucherStatusOf(row.lifecycleState, row.voidReason) ?? null,
      currency: row.currency,
      faceValueMinor: row.faceValueMinor,
      remainingValueMinor: row.remainingValueMinor,
      issuedAt: burnAtByVoucher.get(row.voucherId) ?? null,
      expiresAt: row.expiresAt,
    })),
    watchSessions: input.sessions.map((session) => ({
      sessionId: session.sessionId,
      campaignId: session.campaignId,
      campaignTitle: session.campaignTitle,
      state: session.state,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      pointsEarned: earnedBySession.get(session.sessionId) ?? 0,
    })),
  };
}
