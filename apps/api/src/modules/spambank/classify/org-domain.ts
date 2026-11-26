import { domainToASCII } from "node:url";
import { getDomain } from "tldts";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOT_ATOM_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;

/**
 * Lower-case ASCII (IDN → punycode) host name without a trailing dot, or
 * null when it is not a valid DNS name (IP literals, empty labels, spaces).
 */
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (d.endsWith(".")) d = d.slice(0, -1);
  if (d === "" || d.length > 253) return null;
  const ascii = domainToASCII(d);
  if (ascii === "" || ascii.length > 253) return null;
  const labels = ascii.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  // An all-digit last label is an IP address, never a mail domain.
  if (/^[0-9]+$/.test(labels[labels.length - 1] ?? "")) return null;
  return ascii;
}

/**
 * Registrable domain under the ICANN section of the Public Suffix List
 * (`news.brand.co.uk` → `brand.co.uk`). Private-section suffixes are ignored
 * on purpose: every `*.myshopify.com` or `*.github.io` sender shares one
 * org domain, so the 30-day per-domain throttle stays conservative.
 */
export function orgDomainOf(domain: string): string | null {
  const d = normalizeDomain(domain);
  if (d === null) return null;
  return getDomain(d, {
    allowPrivateDomains: false,
    extractHostname: false,
    validateHostname: false,
    detectIp: true,
  });
}

export interface SplitAddress {
  /** As written (case kept, quotes kept). */
  readonly local: string;
  /** Normalised by `normalizeDomain`. */
  readonly domain: string;
}

/** Splits at the LAST `@` (a quoted local part may contain one). */
export function splitAddress(email: string): SplitAddress | null {
  const addr = email.trim();
  const at = addr.lastIndexOf("@");
  if (at <= 0 || at === addr.length - 1) return null;
  const local = addr.slice(0, at);
  if (local.length > 64 || hasControlChar(local) || /\s/.test(local.replace(/"[^"]*"/g, ""))) {
    return null;
  }
  const domain = normalizeDomain(addr.slice(at + 1));
  return domain === null ? null : { local, domain };
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** A plain dot-atom local part: safe to put in an SMTP envelope as is. */
export function isDotAtomLocalPart(local: string): boolean {
  return local.length <= 64 && DOT_ATOM_LOCAL.test(local);
}
