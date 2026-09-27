/**
 * The real wallet API (4.8, TASKS.md) only promises three coarse states —
 * `reserved` (mid-checkout, allocated against a saga), `activated` (held by
 * the owner — covers active/held/redeemed/expired/voided alike until the
 * voucher-internal wallet read widens, see wallet-data.ts's doc comment) and
 * `released` (the checkout that would have minted it was abandoned). This
 * feature never invents a finer status than the API actually reports.
 */
export type WalletVoucherState = "reserved" | "activated" | "released";

export type VoucherStatusKind = "held" | "pending" | "released" | "expired";

/** Matches `@yourtal/ui/status-badge`'s `status` variant. */
export type BadgeStatus = "success" | "warning" | "danger" | "info" | "neutral";

export interface VoucherStatusClassification {
  kind: VoucherStatusKind;
  badgeStatus: BadgeStatus;
  /** A voucher whose QR/code can no longer be presented at the counter. */
  isArchived: boolean;
}

/** The `wallet` catalogue key for each status — shared so a Server and a Client caller translate the exact same key. */
export const VOUCHER_STATUS_MESSAGE_KEY: Record<
  VoucherStatusKind,
  | "voucher.statusHeld"
  | "voucher.statusPending"
  | "voucher.statusReleased"
  | "voucher.statusExpired"
> = {
  held: "voucher.statusHeld",
  pending: "voucher.statusPending",
  released: "voucher.statusReleased",
  expired: "voucher.statusExpired",
};

/**
 * True once a voucher's `expiresAt` has passed by wall-clock time — a
 * client-computed archival signal independent of what the (currently
 * coarse) `state` field says, same reasoning as the rest of this file.
 * Only meaningful when `expiresAt` is known (see wallet-data.ts: it is not
 * yet part of the live contract), hence the optional input.
 */
export function isVoucherEffectivelyExpired(expiresAt: string | undefined, nowMs: number): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= nowMs;
}

/**
 * Classifies a voucher's status only — no translation. Safe to use from a
 * client leaf or a Server Component alike.
 */
export function classifyVoucherStatus(
  state: WalletVoucherState,
  isEffectivelyExpired: boolean,
): VoucherStatusClassification {
  if (isEffectivelyExpired) {
    return { kind: "expired", badgeStatus: "danger", isArchived: true };
  }
  if (state === "released") {
    return { kind: "released", badgeStatus: "neutral", isArchived: true };
  }
  if (state === "reserved") {
    return { kind: "pending", badgeStatus: "info", isArchived: false };
  }
  return { kind: "held", badgeStatus: "success", isArchived: false };
}

/** A translator with next-intl's call signature — `getTranslations` (server) and `useTranslations` (client) both satisfy this. */
export type Translator = (key: string, values?: Record<string, string | number>) => string;

export interface VoucherStatusCopy extends VoucherStatusClassification {
  label: string;
}

/**
 * Plain-language status copy for a voucher. Takes the caller's OWN
 * translator rather than a locale, so a Server Component (`getTranslations`)
 * and a Client Component (`useTranslations`) share this one function instead
 * of each needing its own copy of the classification-to-label mapping.
 */
export function describeVoucherStatus(
  state: WalletVoucherState,
  isEffectivelyExpired: boolean,
  t: Translator,
): VoucherStatusCopy {
  const classification = classifyVoucherStatus(state, isEffectivelyExpired);
  return { ...classification, label: t(VOUCHER_STATUS_MESSAGE_KEY[classification.kind]) };
}
