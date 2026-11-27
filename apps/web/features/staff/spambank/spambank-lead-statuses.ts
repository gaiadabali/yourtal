/**
 * The lead statuses, kept out of `spambank-staff-contract.ts` on purpose: that
 * file pulls in zod, and client components that only need this list (the edit
 * dialog) must not drag zod into the initial JS (the 200 KB gz route gate).
 */
export const LEAD_STATUSES = ["new", "contacted", "ignored", "customer"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
