import type { BoundaryFailure } from "../fault-engine";
import type { Result } from "neverthrow";
import type { EmailDriver, EmailMessage, EmailSent } from "./email";

/**
 * F115: on staging, real email goes only to an allow-list; everyone else lands
 * in the simulated dev inbox. Staging sends through another product's Resend
 * account, so a bounce to a fake `.test` address would hurt its sender reputation.
 *
 * `EMAIL_LIVE_ALLOWLIST` is comma-separated: exact addresses (`a@b.example`)
 * and `@domain` entries (`@b.example`, that exact domain only, not subdomains),
 * matched case-insensitively. Blank items (a trailing comma) are skipped.
 *
 * An EMPTY or unset list means "no restriction": live sends to everyone. That
 * is production behaviour, and staging refuses it.
 *
 * The single entry `*` is the explicit "everyone" form (owner decision
 * 2026-11-26: YourTal emails every recipient like a real app, staging
 * included). It counts as a non-empty list for the staging check, nothing goes
 * to the simulated outbox, and it must be the ONLY entry: `*` beside other
 * entries is malformed, because a half-restricted list is a typo, not intent.
 *
 * A malformed entry REFUSES to boot rather than being dropped with a warning.
 * Dropping it is the dangerous path: a list whose entries were all malformed
 * would parse to empty, and empty means "send to everyone". Failing closed
 * also surfaces a typo before staging silently stops delivering to a tester.
 */

export interface AllowList {
  readonly addresses: ReadonlySet<string>;
  readonly domains: ReadonlySet<string>;
  /** The single entry `*`: every recipient goes live (owner decision 2026-11-26). */
  readonly everyone: boolean;
}

const ADDRESS = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const DOMAIN = /^@[^\s@,<>]+\.[^\s@,<>]+$/;

/** Parses the raw setting. Throws on a malformed entry; never echoes the entry. */
export function parseEmailAllowList(raw: string | undefined): AllowList {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  const items = (raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  if (items.includes("*")) {
    if (items.length > 1) {
      throw new Error(
        'EMAIL_LIVE_ALLOWLIST is malformed: "*" (everyone) must be the only entry, not mixed with addresses or domains.',
      );
    }
    return { addresses, domains, everyone: true };
  }
  items.forEach((item, index) => {
    if (DOMAIN.test(item)) domains.add(item);
    else if (ADDRESS.test(item)) addresses.add(item);
    else {
      throw new Error(
        `EMAIL_LIVE_ALLOWLIST entry ${String(index + 1)} is malformed: use exact addresses or "@domain" entries, comma-separated.`,
      );
    }
  });
  return { addresses, domains, everyone: false };
}

export function isAllowListEmpty(list: AllowList): boolean {
  return !list.everyone && list.addresses.size === 0 && list.domains.size === 0;
}

function isListed(list: AllowList, recipient: string): boolean {
  if (list.everyone) return true;
  const normalised = recipient.trim().toLowerCase();
  if (list.addresses.has(normalised)) return true;
  const at = normalised.lastIndexOf("@");
  return at >= 0 && list.domains.has(normalised.slice(at));
}

/** Listed recipients go through `live`; all others go to `simulated`. Reports mode "live". */
export function createAllowListEmail(
  live: EmailDriver,
  simulated: EmailDriver,
  list: AllowList,
): EmailDriver {
  return {
    mode: live.mode,
    send(message: EmailMessage): Promise<Result<EmailSent, BoundaryFailure>> {
      return isListed(list, message.to) ? live.send(message) : simulated.send(message);
    },
  };
}
