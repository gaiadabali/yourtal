/**
 * A short, well-known list of disposable-email domains (F126). It is a
 * speed bump for the obvious throwaway inboxes, not a complete blocklist.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
  "fakeinbox.com",
  "mintemail.com",
  "emailondeck.com",
  "mohmal.com",
  "tempr.email",
  "discard.email",
  "burnermail.io",
];

/**
 * Whether the address's domain is a listed one or a subdomain of one
 * (`a.mailinator.com`), compared case-insensitively. An address with no
 * `@` is not a disposable one; whether it is an address at all is not this
 * function's question.
 */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return DISPOSABLE_EMAIL_DOMAINS.some(
    (listed) => domain === listed || domain.endsWith(`.${listed}`),
  );
}
