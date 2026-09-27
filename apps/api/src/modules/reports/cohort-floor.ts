/**
 * F12's cohort floors: "Business reports never show a group smaller than
 * 10 (teens 20)." Constants here, not a `region_setting` row, the same
 * handoff `ledger-client`'s pricing (`fake-ledger-pricing.ts`) and rewards
 * (`rewards.ts`) constants both note -- 1.2.f seeded the OTHER F12 defaults;
 * this one has no key yet because Reports (7.6) is the first thing that
 * needs it. Move it into `platform.region_setting` when the staff console
 * (9.5) wants it editable.
 */
export const COHORT_FLOOR = 10;
export const TEEN_COHORT_FLOOR = 20;
