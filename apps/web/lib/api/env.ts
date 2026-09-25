import "server-only";

/**
 * The API's internal, server-to-server base URL (1.7.a). Never exposed to
 * the browser — no `NEXT_PUBLIC_` prefix, and every reader of it
 * (`apiFetch`) is itself `server-only`. It has no default: a silently-wrong
 * fallback host is worse than a loud boot-time failure the first time a
 * Server Component actually calls out, matching `apps/api`'s own
 * `CHECKPOINT_TOKEN_SECRET` convention of "no default in `env.schema.ts` on
 * purpose" for anything that would be a bad thing to guess.
 */
export function apiInternalUrl(): string {
  const url = process.env["API_INTERNAL_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "API_INTERNAL_URL is not set. Add it to .env (see .env.example) — " +
        "apps/web talks to apps/api only through this variable.",
    );
  }
  return url;
}
