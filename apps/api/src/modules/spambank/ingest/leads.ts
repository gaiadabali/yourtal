import { cleanText } from "./db";
import type { MailboxRow, Queryable } from "./db";

/**
 * BUILD.md §4.7 (D2 B): a brand that mailed a Spambank person is a lead for GOD's sales team, one list per
 * region (AU and ID never mix: the region is the recipient mailbox's). `lead` is one row per brand; the
 * sighting is one row per (brand, mailbox), so "recipients" is a count of distinct people, never a list.
 * The first sample sticks: a later message only moves `last_seen_at` and the counters.
 */
export interface LeadSighting {
  readonly orgDomain: string;
  readonly fromAddress: string | null;
  readonly displayName: string | null;
  readonly subject: string | null;
  readonly hasListUnsubscribe: boolean;
  readonly seenAt: Date;
}

export async function recordLead(
  db: Queryable,
  mailbox: Pick<MailboxRow, "id" | "region">,
  sighting: LeadSighting,
): Promise<void> {
  await db.query(
    `INSERT INTO spambank.lead
       (region, org_domain, display_name, sample_from, sample_subject, has_list_unsubscribe,
        first_seen_at, last_seen_at, messages)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 1)
     ON CONFLICT (region, org_domain) DO UPDATE SET
       first_seen_at        = LEAST(spambank.lead.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at         = GREATEST(spambank.lead.last_seen_at, EXCLUDED.last_seen_at),
       messages             = spambank.lead.messages + 1,
       has_list_unsubscribe = spambank.lead.has_list_unsubscribe OR EXCLUDED.has_list_unsubscribe,
       display_name         = COALESCE(spambank.lead.display_name, EXCLUDED.display_name)`,
    [
      mailbox.region,
      sighting.orgDomain,
      cleanText(sighting.displayName, 120),
      cleanText(sighting.fromAddress, 254),
      cleanText(sighting.subject, 200),
      sighting.hasListUnsubscribe,
      sighting.seenAt,
    ],
  );
  await db.query(
    `INSERT INTO spambank.lead_sighting
       (region, org_domain, mailbox_id, first_seen_at, last_seen_at, messages)
     VALUES ($1, $2, $3, $4, $4, 1)
     ON CONFLICT (region, org_domain, mailbox_id) DO UPDATE SET
       first_seen_at = LEAST(spambank.lead_sighting.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at  = GREATEST(spambank.lead_sighting.last_seen_at, EXCLUDED.last_seen_at),
       messages      = spambank.lead_sighting.messages + 1`,
    [mailbox.region, sighting.orgDomain, mailbox.id, sighting.seenAt],
  );
}
