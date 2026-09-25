/**
 * Turning a date of birth into an age, and an age into the two account age
 * bands that can exist (1.4.a/1.4.b, TASKS.md). `identity.user_profile`
 * stores `date_of_birth` and nothing else age-related — `age_band` is
 * computed at read time, from here, never stored, so it cannot drift the
 * day a birthday passes without a write to refresh it.
 */

/**
 * Whole years between a date of birth and `now`, using UTC calendar fields
 * throughout so the answer does not depend on the server's local timezone.
 * `dateOfBirth` is an ISO date string (`YYYY-MM-DD`, matching the Postgres
 * `date` column `identity.user_profile.date_of_birth` reads back as).
 */
export function ageYearsFrom(dateOfBirth: string, now: Date): number {
  const dob = new Date(dateOfBirth);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * The age band for an account that ALREADY EXISTS — never called for an age
 * that would have been refused at registration (under 13 has no account at
 * all; 1.4.b). Structurally the same two-value union
 * `@yourtal/contracts/audience`'s `AgeBand` declares, restated here rather
 * than imported so this package keeps its zero-dependency policy-data
 * discipline (AC3) — the two are the same shape by construction, not by
 * import.
 */
export function ageBandFrom(ageYears: number): "teen" | "adult" {
  return ageYears >= 18 ? "adult" : "teen";
}
