import { createHmac, timingSafeEqual } from "node:crypto";
import {
  OPTOUT_DOMAIN_PATTERN,
  OPTOUT_SIG_PATTERN,
  SPAMBANK_OPTOUT_PAGE_PREFIX,
  SPAMBANK_OPTOUT_PREFIX,
} from "@yourtal/contracts/spambank/staff";
import type { Queryable } from "../ingest/db";

/**
 * The counter-spam reply's opt-out (BUILD.md §4.6, D2 5). A link names a registrable domain and carries
 * `sig` = the first 22 characters of `base64url(HMAC-SHA256(SPAMBANK_OPTOUT_KEY, "optout:v1:" + domain))`,
 * so nobody can opt a domain out without a reply we sent to it, and nothing per link is stored. Opting out
 * is forever: `autoreply_domain.opted_out_at` is never cleared by code.
 */

const SIG_LENGTH = 22;

/** Lower-case, and the shape a registrable domain has; null otherwise (the link is refused unread). */
export function canonicalOptoutDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  return OPTOUT_DOMAIN_PATTERN.test(domain) ? domain : null;
}

export function optoutSig(key: string, domain: string): string {
  return createHmac("sha256", key)
    .update(`optout:v1:${domain}`)
    .digest("base64url")
    .slice(0, SIG_LENGTH);
}

/** Constant-time; false for anything not shaped like a signature. `domain` must be canonical. */
export function verifyOptoutSig(key: string, domain: string, sig: string): boolean {
  if (!OPTOUT_SIG_PATTERN.test(sig)) return false;
  const expected = Buffer.from(optoutSig(key, domain));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface OptoutLinks {
  /** RFC 8058 one-click target, for `List-Unsubscribe` (POST opts out; GET only reads). */
  readonly oneClick: string;
  /** The web page with a confirm button, for the reply's body (`{{OPTOUT_URL}}`). */
  readonly page: string;
}

export function optoutLinks(origin: string, key: string, domain: string): OptoutLinks {
  const path = `${encodeURIComponent(domain)}/${optoutSig(key, domain)}`;
  return {
    oneClick: `${origin}${SPAMBANK_OPTOUT_PREFIX}/${path}`,
    page: `${origin}${SPAMBANK_OPTOUT_PAGE_PREFIX}/${path}`,
  };
}

/** Opts a domain out (idempotent: the first date is kept). Returns that date. */
export async function optOutDomain(db: Queryable, domain: string, now: Date): Promise<Date> {
  const { rows } = await db.query<{ opted_out_at: Date }>(
    `INSERT INTO spambank.autoreply_domain (org_domain, opted_out_at) VALUES ($1, $2)
     ON CONFLICT (org_domain) DO UPDATE
       SET opted_out_at = COALESCE(spambank.autoreply_domain.opted_out_at, EXCLUDED.opted_out_at)
     RETURNING opted_out_at`,
    [domain, now],
  );
  const at = rows[0]?.opted_out_at;
  if (at === undefined) throw new Error("opt-out upsert returned no row");
  return at;
}

export async function isOptedOut(db: Queryable, domain: string): Promise<boolean> {
  const { rows } = await db.query<{ opted: boolean }>(
    "SELECT opted_out_at IS NOT NULL AS opted FROM spambank.autoreply_domain WHERE org_domain = $1",
    [domain],
  );
  return rows[0]?.opted === true;
}
