/**
 * Every (auth) screen's own `errors.<code>` catalogue entry, keyed by
 * whatever `ApiError` produces (`lib/api/actions.ts`'s own `errorCode`
 * convention: a domain code from the API — `invalid_credentials`,
 * `too_young`, `token_invalid`, ... — or `network`/`invalid_response` for a
 * plumbing failure). Falls back to that namespace's own `errors.unknown`
 * for a code the catalogue doesn't name explicitly, so a new API error
 * variant degrades to a generic plain-language message instead of a raw
 * code or a next-intl "MISSING_MESSAGE" string.
 */
export interface AuthTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export function authErrorMessage(t: AuthTranslator, code: string): string {
  const key = `errors.${code}`;
  return t.has(key) ? t(key) : t("errors.unknown");
}
