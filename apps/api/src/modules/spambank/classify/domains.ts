import { orgDomainOf } from "./org-domain";

/** BUILD.md §4.6 check 6. Always protected, whatever `SPAMBANK_OWN_DOMAINS` says. */
export const DEFAULT_OWN_DOMAINS: readonly string[] = [
  "gaiada.com",
  "freetaxreturns.com.au",
  "yourtal.com",
];

/** Mailbox providers, by registrable domain. */
const FREEMAIL_EXACT: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "zoho.com",
  "bigpond.com",
  "optusnet.com.au",
  // Beyond §4.6's list: same providers under another name.
  "pm.me",
  "protonmail.ch",
  "bigpond.net.au",
]);

/**
 * Providers matched under any public suffix (`yahoo.co.id`, `gmx.de`).
 * §4.6 names yahoo, gmx and yandex; hotmail, outlook, live and aol are added
 * for their regional domains (`hotmail.co.uk`, `outlook.co.id`). Over-matching
 * only skips a reply or a lead, never sends one.
 */
const FREEMAIL_ANY_SUFFIX: ReadonlySet<string> = new Set([
  "yahoo",
  "gmx",
  "yandex",
  "hotmail",
  "outlook",
  "live",
  "aol",
]);

/** `orgDomain` must already be a registrable domain (`orgDomainOf`). */
export function isFreemail(orgDomain: string): boolean {
  if (FREEMAIL_EXACT.has(orgDomain)) return true;
  const first = orgDomain.split(".")[0] ?? "";
  return FREEMAIL_ANY_SUFFIX.has(first);
}

export function isOwnDomain(orgDomain: string, ownOrgDomains: readonly string[]): boolean {
  // Exact match on whole registrable domains (an array lookup, not a substring test).
  return ownOrgDomains.some((d) => d === orgDomain);
}

/**
 * `SPAMBANK_OWN_DOMAINS` (comma-separated) → registrable domains, always
 * including the defaults: the setting can add domains, never drop gaiada.com.
 * Throws on an entry that is not a domain, so a typo fails config loading.
 */
export function parseOwnDomains(raw: string | undefined): readonly string[] {
  const out = new Set<string>();
  const entries = [...DEFAULT_OWN_DOMAINS, ...(raw ?? "").split(",")];
  for (const entry of entries) {
    if (entry.trim() === "") continue;
    const org = orgDomainOf(entry);
    if (org === null) throw new Error(`SPAMBANK_OWN_DOMAINS: "${entry.trim()}" is not a domain`);
    out.add(org);
  }
  return [...out];
}
