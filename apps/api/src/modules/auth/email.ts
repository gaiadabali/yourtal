/**
 * The one normalisation every lookup against `identity.credential.user_id`
 * must apply, because — see the migration header — `user_id` for an
 * email-and-password account IS the email, and two callers spelling the
 * same address differently must resolve to the same row.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
