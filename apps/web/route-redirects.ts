/**
 * `proxy.ts`'s redirect table (1.7.c) — starts empty; each area adds its own
 * rules here as it needs them (this file is listed as shared in `TASKS.md`'s
 * ownership table: "add your own lines only"). Kept separate from `proxy.ts`
 * itself (Area A-owned) so a redirect rule never requires touching the auth
 * gate.
 *
 * `/` is the signed-in home at `/home`; signed out it is the AU landing page
 * until 11.1.a gives `/` a public page of its own.
 */
export interface RouteRedirectRule {
  /** Exact pathname to match (no query string, no trailing slash). */
  readonly path: string;
  /** Returns the destination pathname, or `null` to leave this request alone. */
  resolve(context: { readonly signedIn: boolean }): string | null;
}

export const routeRedirects: readonly RouteRedirectRule[] = [
  // Area B (3.5.d).
  { path: "/", resolve: ({ signedIn }) => (signedIn ? "/home" : "/au") },
];
