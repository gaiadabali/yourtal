/**
 * `GET /api/me`'s own read of `business.business_members` (1.4.d) — a
 * summary, not the roster: "these are root routes only; ... C's `business`
 * module owns `/api/me/businesses`" (TASKS.md 1.4.d) for the full detail.
 */
export interface BusinessMembershipSummary {
  readonly businessId: string;
  readonly role: string;
}

export interface BusinessMembershipReader {
  /** Only memberships where `joined_at` is set — an outstanding invite is not a membership yet. */
  listForUser(userId: string): Promise<readonly BusinessMembershipSummary[]>;
}

export const BUSINESS_MEMBERSHIP_READER = Symbol("BUSINESS_MEMBERSHIP_READER");
