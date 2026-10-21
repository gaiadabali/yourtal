/**
 * The provider's interaction ids are URL-safe tokens. Anything else in the
 * path is not one of ours, so it never reaches the API or a redirect.
 */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isInteractionUid(value: string): boolean {
  return UID_PATTERN.test(value);
}

/** `/connect/<uid>`: where the provider sends the browser, and where `/login` and `/register` return to. */
export function connectPath(uid: string): string {
  return `/connect/${uid}`;
}
