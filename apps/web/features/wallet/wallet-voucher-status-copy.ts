/**
 * The wallet API's original, coarse read (4.8.a) only promised three states
 * — `reserved` (mid-checkout, allocated against a saga), `activated` (held
 * by the owner — covered active/held/redeemed/expired/voided alike) and
 * `released` (the checkout that would have minted it was abandoned).
 * `state` still carries exactly this, byte for byte, for back-compat
 * (wallet-data.ts's doc comment on 4.8.c).
 */
export type WalletVoucherState = "reserved" | "activated" | "released";

/**
 * 11.6.d: the voucher's REAL lifecycle, additive over `state` (4.8.c,
 * merged on main) — `publicVoucherStatusOf`'s public form. `undefined`
 * means a response from before 4.8.c landed; every function below falls
 * back to classifying `state` alone in that case.
 */
export type WalletVoucherStatus = "active" | "redeemed" | "expired" | "transferred";

export type VoucherStatusKind =
  | "held"
  | "pending"
  | "released"
  | "expired"
  | "redeemed"
  | "transferred";

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
  | "voucher.statusRedeemed"
  | "voucher.statusTransferred"
> = {
  held: "voucher.statusHeld",
  pending: "voucher.statusPending",
  released: "voucher.statusReleased",
  expired: "voucher.statusExpired",
  redeemed: "voucher.statusRedeemed",
  transferred: "voucher.statusTransferred",
};

/**
 * True once a voucher's `expiresAt` has passed by wall-clock time — a
 * client-computed archival signal independent of what `state`/`status` say,
 * same reasoning as the rest of this file. Only meaningful when `expiresAt`
 * is known, hence the optional input.
 */
export function isVoucherEffectivelyExpired(expiresAt: string | undefined, nowMs: number): boolean {
  return expiresAt !== undefined && new Date(expiresAt).getTime() <= nowMs;
}

/**
 * Classifies a voucher's status only — no translation. Safe to use from a
 * client leaf or a Server Component alike.
 *
 * Prefers the real `status` (11.6.d) when the response carries one; a
 * client-side `isEffectivelyExpired` still wins even then (a wall-clock
 * check the server response cannot race). Falls back to the original
 * three-bucket `state` classification when `status` is absent — a response
 * from before 4.8.c landed.
 */
export function classifyVoucherStatus(
  state: WalletVoucherState,
  isEffectivelyExpired: boolean,
  status?: WalletVoucherStatus,
): VoucherStatusClassification {
  if (isEffectivelyExpired) {
    return { kind: "expired", badgeStatus: "danger", isArchived: true };
  }
  if (status !== undefined) {
    switch (status) {
      case "active":
        return { kind: "held", badgeStatus: "success", isArchived: false };
      case "redeemed":
        return { kind: "redeemed", badgeStatus: "neutral", isArchived: true };
      case "expired":
        return { kind: "expired", badgeStatus: "danger", isArchived: true };
      case "transferred":
        return { kind: "transferred", badgeStatus: "neutral", isArchived: true };
      default: {
        const exhaustive: never = status;
        return exhaustive;
      }
    }
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
  status?: WalletVoucherStatus,
): VoucherStatusCopy {
  const classification = classifyVoucherStatus(state, isEffectivelyExpired, status);
  return { ...classification, label: t(VOUCHER_STATUS_MESSAGE_KEY[classification.kind]) };
}

/**
 * Whether a voucher can still be presented at the counter right now — the
 * one gate `wallet-voucher-list.tsx` (active vs. archived), the voucher
 * detail page (whether to fetch a QR at all) and `voucher-detail-view.tsx`
 * (whether to render the QR) each need. Prefers `status === "active"`
 * (11.6.d — folds in a mid-hold voucher too, `publicVoucherStatusOf`'s own
 * doc comment) and falls back to the original `state === "activated"` check
 * when `status` has not landed yet.
 */
export function isVoucherRedeemable(
  voucher: {
    state: WalletVoucherState;
    status?: WalletVoucherStatus | undefined;
    expiresAt?: string | undefined;
  },
  nowMs: number,
): boolean {
  if (isVoucherEffectivelyExpired(voucher.expiresAt, nowMs)) return false;
  return voucher.status !== undefined ? voucher.status === "active" : voucher.state === "activated";
}
