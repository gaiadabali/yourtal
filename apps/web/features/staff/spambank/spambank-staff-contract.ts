import * as z from "zod";

/**
 * The staff and opt-out wire shapes of spambank/BUILD.md 5.4, written down
 * here because T7 (which owns the API and `packages/contracts/src/spambank/
 * staff.ts`) has not merged. When it does, these schemas move to that file
 * and this one becomes a re-export; the shapes must not change.
 */

export const LEAD_STATUSES = ["new", "contacted", "ignored", "customer"] as const;
export const leadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const spambankLeadSchema = z.object({
  orgDomain: z.string().min(1),
  displayName: z.string().nullable(),
  sampleFrom: z.string().nullable(),
  sampleSubject: z.string().nullable(),
  recipients: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  status: leadStatusSchema,
  note: z.string().nullable(),
  autoRepliedAt: z.iso.datetime().nullable(),
  optedOutAt: z.iso.datetime().nullable(),
});
export type SpambankLead = z.infer<typeof spambankLeadSchema>;

/** `GET /api/staff/spambank/leads?status=&q=&cursor=` */
export const spambankLeadPageSchema = z.object({
  items: z.array(spambankLeadSchema),
  nextCursor: z.string().nullable(),
});
export type SpambankLeadPage = z.infer<typeof spambankLeadPageSchema>;

export const AUTOREPLY_MODES = ["off", "dry_run", "redirect", "live"] as const;
export const BLOCKLIST_RESULTS = ["clean", "listed", "refused", "error"] as const;

/** One row of `spambank.blocklist_check` (BUILD.md 6): the card leaves the item shape open, this is the table's own. */
export const blocklistCheckSchema = z.object({
  checkedAt: z.iso.datetime(),
  target: z.string(),
  list: z.string(),
  result: z.enum(BLOCKLIST_RESULTS),
  detail: z.string().nullable(),
});
export type BlocklistCheck = z.infer<typeof blocklistCheckSchema>;

/** `GET /api/staff/spambank/autoreply` */
export const spambankAutoreplySchema = z.object({
  mode: z.enum(AUTOREPLY_MODES),
  tripped: z.boolean(),
  pausedAt: z.iso.datetime().nullable(),
  pausedReason: z.string().nullable(),
  dailyCap: z.number().int().positive(),
  today: z.object({
    sent: z.number().int().nonnegative(),
    bounces: z.number().int().nonnegative(),
    complaints: z.number().int().nonnegative(),
  }),
  lastBlocklist: z.array(blocklistCheckSchema),
});
export type SpambankAutoreply = z.infer<typeof spambankAutoreplySchema>;

/** `POST /api/staff/spambank/autoreply` body. */
export interface SpambankAutoreplyChange {
  readonly tripped?: boolean;
  readonly dailyCap?: number;
  readonly resume?: boolean;
  readonly reason: string;
}

/** Opt-out link shape (BUILD.md 4.6): 22 chars of base64url; a domain is a plain host name. */
export const OPTOUT_SIG = /^[A-Za-z0-9_-]{22}$/;
export const OPTOUT_DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * `GET /api/spambank/optout/:domain/:sig`: read-only status of a signed link
 * (never opts out). NOT in BUILD.md 5.4 -- T7 must add it so the page can say
 * "done" on a second visit. 404 `invalid_link` for a bad signature.
 */
export const optoutStatusSchema = z.object({
  domain: z.string().min(1),
  optedOut: z.boolean(),
});
export type OptoutStatus = z.infer<typeof optoutStatusSchema>;
