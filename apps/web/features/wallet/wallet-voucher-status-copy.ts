import type { Voucher, VoucherStatus } from "@yourtal/contracts/voucher";
import type { BadgeProps } from "@yourtal/ui/badge";

export interface VoucherStatusCopy {
  label: string;
  badgeVariant: NonNullable<BadgeProps["variant"]>;
  /** Used, expired or transferred — YT-0424: archived, never hidden, never deleted. */
  isArchived: boolean;
}

/**
 * True once a voucher's `expiresAt` has passed by wall-clock time,
 * regardless of what its `status` field currently says. Mock fixtures
 * (`expiringWithinHourVoucherFixture`) are minted against a fixed
 * reference instant and can drift into the past purely by the calendar
 * moving on, independent of any lifecycle transition — the UI must treat
 * that the same as a real expiry, not just trust a possibly-stale status.
 */
export function isVoucherEffectivelyExpired(voucher: Pick<Voucher, "expiresAt">, nowMs: number): boolean {
  return new Date(voucher.expiresAt).getTime() <= nowMs;
}

/**
 * Plain-language status copy for a voucher, only type-importing
 * `@yourtal/contracts/voucher` — never a value import, so this is safe to
 * use from a client leaf too (docs/13b-typescript-standards.md §8's
 * initial-JS budget rule 1).
 */
export function describeVoucherStatus(status: VoucherStatus, isEffectivelyExpired: boolean): VoucherStatusCopy {
  if (status === "redeemed") {
    return { label: "Sudah dipakai", badgeVariant: "secondary", isArchived: true };
  }
  if (status === "transferred") {
    return { label: "Sudah ditransfer", badgeVariant: "outline", isArchived: true };
  }
  if (status === "expired" || isEffectivelyExpired) {
    return { label: "Kedaluwarsa", badgeVariant: "danger", isArchived: true };
  }
  return { label: "Aktif", badgeVariant: "success", isArchived: false };
}
