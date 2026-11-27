import * as z from "zod";
import { AUTOREPLY_MODES } from "./common";

/**
 * Spambank's staff API and the auto-reply opt-out (spambank/BUILD.md §4.6, §4.7, §5.4). The shapes are the
 * ones T9's screens were built against (`apps/web/features/staff/spambank/spambank-staff-contract.ts`);
 * that file re-exports these once both have merged.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** §4.7: a lead's sales status. */
export const LEAD_STATUSES = ["new", "contacted", "ignored", "customer"] as const;
export const leadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** A lead note: free text for GOD's sales team, one paragraph. */
export const LEAD_NOTE_MAX = 1000;

/** One brand that mailed users of the staff member's region. */
export const spambankLeadSchema = z.object({
  /** Registrable domain, lower-case. */
  orgDomain: z.string().min(1),
  displayName: z.string().nullable(),
  sampleFrom: z.string().nullable(),
  sampleSubject: z.string().nullable(),
  /** Mailboxes in the region that received mail from the brand. */
  recipients: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  firstSeenAt: isoDateTime,
  lastSeenAt: isoDateTime,
  status: leadStatusSchema,
  note: z.string().nullable(),
  /** The last counter-spam reply to the domain (any region: the guards are global). */
  autoRepliedAt: isoDateTime.nullable(),
  optedOutAt: isoDateTime.nullable(),
});
export type SpambankLead = z.infer<typeof spambankLeadSchema>;

/** `GET /api/staff/spambank/leads?status=&q=&cursor=`: newest sighting first, 50 a page. */
export const spambankLeadPageSchema = z.object({
  items: z.array(spambankLeadSchema),
  nextCursor: z.string().nullable(),
});
export type SpambankLeadPage = z.infer<typeof spambankLeadPageSchema>;

export const LEAD_PAGE_SIZE = 50;
/** The CSV export's ceiling: one region's list, not a data dump. */
export const LEAD_EXPORT_MAX = 10_000;

/** The list's query string. `cursor` is opaque (base64url), from the previous page. */
export const spambankLeadQuerySchema = z.object({
  status: leadStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]*$/)
    .optional(),
});
export type SpambankLeadQuery = z.infer<typeof spambankLeadQuerySchema>;

/** `PATCH /api/staff/spambank/leads/:orgDomain`: at least one of the two. `note: null` clears it. */
export const spambankLeadUpdateSchema = z
  .object({
    status: leadStatusSchema.optional(),
    note: z.string().trim().max(LEAD_NOTE_MAX).nullable().optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.note !== undefined, {
    message: "Send a status, a note, or both.",
  });
export type SpambankLeadUpdate = z.infer<typeof spambankLeadUpdateSchema>;

export const BLOCKLIST_RESULTS = ["clean", "listed", "refused", "error"] as const;
export type BlocklistResult = (typeof BLOCKLIST_RESULTS)[number];

/** One row of `spambank.blocklist_check`. */
export const blocklistCheckSchema = z.object({
  checkedAt: isoDateTime,
  target: z.string(),
  list: z.string(),
  result: z.enum(BLOCKLIST_RESULTS),
  detail: z.string().nullable(),
});
export type BlocklistCheck = z.infer<typeof blocklistCheckSchema>;

/** `GET /api/staff/spambank/autoreply`. */
export const spambankAutoreplySchema = z.object({
  /** `SPAMBANK_AUTOREPLY_MODE`: the hard switch; changing it needs a restart. */
  mode: z.enum(AUTOREPLY_MODES),
  /** The staff kill switch (instant). */
  tripped: z.boolean(),
  /** The auto-pause (bounces, complaints, a blocklist listing); only staff resume it. */
  pausedAt: isoDateTime.nullable(),
  pausedReason: z.string().nullable(),
  /** `0` stops every reply until it is raised. */
  dailyCap: z.number().int().nonnegative(),
  today: z.object({
    sent: z.number().int().nonnegative(),
    bounces: z.number().int().nonnegative(),
    complaints: z.number().int().nonnegative(),
  }),
  /** The latest result per target and list. */
  lastBlocklist: z.array(blocklistCheckSchema),
});
export type SpambankAutoreply = z.infer<typeof spambankAutoreplySchema>;

export const AUTOREPLY_DAILY_CAP_MAX = 10_000;

/** `POST /api/staff/spambank/autoreply`: trip or clear the kill switch, change the cap, resume after a pause. */
export const spambankAutoreplyChangeSchema = z
  .object({
    tripped: z.boolean().optional(),
    dailyCap: z.number().int().min(0).max(AUTOREPLY_DAILY_CAP_MAX).optional(),
    resume: z.literal(true).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine(
    (body) => body.tripped !== undefined || body.dailyCap !== undefined || body.resume === true,
    { message: "Send tripped, dailyCap or resume." },
  );
export type SpambankAutoreplyChange = z.infer<typeof spambankAutoreplyChangeSchema>;

/** §4.6: the opt-out signature is the first 22 characters of a base64url HMAC. */
export const OPTOUT_SIG_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** A plain host name: what a registrable domain looks like in the link (IDNs are in punycode). */
export const OPTOUT_DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

/**
 * `GET /api/spambank/optout/:domain/:sig`: read-only status of a signed link (a GET never opts out, so a
 * link scanner changes nothing). 404 `invalid_link` for a bad signature.
 * `POST` to the same path (RFC 8058 one-click, any body) opts the domain out: `200 text/plain`.
 */
export const optoutStatusSchema = z.object({
  domain: z.string().min(1),
  optedOut: z.boolean(),
});
export type OptoutStatus = z.infer<typeof optoutStatusSchema>;

export const SPAMBANK_OPTOUT_PREFIX = "/api/spambank/optout";
/** The web page the reply's body links to; the header's one-click URL is the API path above. */
export const SPAMBANK_OPTOUT_PAGE_PREFIX = "/spambank/optout";
