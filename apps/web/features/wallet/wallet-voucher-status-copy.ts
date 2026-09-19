import type { Voucher, VoucherStatus } from "@yourtal/contracts/voucher";
import type { BadgeProps } from "@yourtal/ui/badge";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export type VoucherStatusKind = "active" | "redeemed" | "transferred" | "expired";

export interface VoucherStatusClassification {
  kind: VoucherStatusKind;
  badgeVariant: NonNullable<BadgeProps["variant"]>;
  /** Used, expired or transferred — YT-0424: archived, never hidden, never deleted. */
  isArchived: boolean;
}

export interface VoucherStatusCopy extends VoucherStatusClassification {
  label: string;
}

/** The `wallet` catalogue key for each status — shared so a Server and a Client caller translate the exact same key. */
export const VOUCHER_STATUS_MESSAGE_KEY: Record<
  VoucherStatusKind,
  | "voucher.statusActive"
  | "voucher.statusRedeemed"
  | "voucher.statusTransferred"
  | "voucher.statusExpired"
> = {
  active: "voucher.statusActive",
  redeemed: "voucher.statusRedeemed",
  transferred: "voucher.statusTransferred",
  expired: "voucher.statusExpired",
};

/**
 * True once a voucher's `expiresAt` has passed by wall-clock time,
 * regardless of what its `status` field currently says. Mock fixtures
 * (`expiringWithinHourVoucherFixture`) are minted against a fixed
 * reference instant and can drift into the past purely by the calendar
 * moving on, independent of any lifecycle transition — the UI must treat
 * that the same as a real expiry, not just trust a possibly-stale status.
 */
export function isVoucherEffectivelyExpired(
  voucher: Pick<Voucher, "expiresAt">,
  nowMs: number,
): boolean {
  return new Date(voucher.expiresAt).getTime() <= nowMs;
}

/**
 * Classifies a voucher's status only — no translation, only type-importing
 * `@yourtal/contracts/voucher` — never a value import, so this is safe to
 * use from a client leaf too (docs/13b-typescript-standards.md §8's
 * initial-JS budget rule 1).
 *
 * Deliberately split from label lookup (YT-0405): a Server caller
 * (`wallet-voucher-card.tsx`) resolves the label via `describeVoucherStatus`
 * below, but a Client caller (`voucher-detail-view.tsx`) must resolve it via
 * its own `useTranslations("wallet")` instead of that function — that
 * function's `getWalletTranslator` statically imports BOTH locales' `wallet`
 * catalogue (see `wallet-i18n.ts`), which is fine from a Server Component
 * (never bundled to the client) but would ship both locales' JSON to the
 * client if reached from one, exactly what docs' "load message catalogues
 * per-locale, not both at once" forbids. `VOUCHER_STATUS_MESSAGE_KEY` above
 * is what lets both callers translate the identical key without either
 * duplicating the mapping or crossing that line.
 */
export function classifyVoucherStatus(
  status: VoucherStatus,
  isEffectivelyExpired: boolean,
): VoucherStatusClassification {
  if (status === "redeemed") {
    return { kind: "redeemed", badgeVariant: "secondary", isArchived: true };
  }
  if (status === "transferred") {
    return { kind: "transferred", badgeVariant: "outline", isArchived: true };
  }
  if (status === "expired" || isEffectivelyExpired) {
    return { kind: "expired", badgeVariant: "danger", isArchived: true };
  }
  return { kind: "active", badgeVariant: "success", isArchived: false };
}

/**
 * Plain-language status copy for a voucher — Server-only despite having no
 * `"use client"` marker of its own, because `getWalletTranslator` statically
 * imports both locales' `wallet.json` (see `classifyVoucherStatus`'s doc
 * comment above). `wallet-voucher-card.tsx` (a Server Component) is this
 * function's only caller; `voucher-detail-view.tsx` (the Client Component
 * that also needs this label) calls `classifyVoucherStatus` plus its own
 * `useTranslations("wallet")` instead.
 *
 * YT-0405: `locale` defaults to `id-ID` so existing callers are unaffected.
 */
export function describeVoucherStatus(
  status: VoucherStatus,
  isEffectivelyExpired: boolean,
  locale: SupportedLocale = "id-ID",
): VoucherStatusCopy {
  const classification = classifyVoucherStatus(status, isEffectivelyExpired);
  const t = getWalletTranslator(locale);
  return { ...classification, label: t(VOUCHER_STATUS_MESSAGE_KEY[classification.kind]) };
}
