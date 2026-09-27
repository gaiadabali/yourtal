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

/**
 * Old business-console path -> its `/studio` equivalent (task 7.8.a). Each
 * rule only fires when signed in — matching `/`'s own pattern above and
 * `proxy.test.ts`'s expectations — so a signed-out visit to an old path
 * still gets the ordinary `/login?returnTo=` treatment first; the same
 * request re-enters `proxy()` signed in after login and is caught here on
 * that pass. Enumerated one path per line rather than a true `:path*`
 * prefix rewrite, because `proxy.ts`'s redirect loop (Area A) only matches
 * a rule's `path` exactly — every one of these seven is every route
 * `(app)/business/**` ever had, so the enumeration is complete today; a
 * genuine prefix match would only matter once Studio grows a nested route
 * under one of these.
 */
function movedToStudio(destination: string): RouteRedirectRule["resolve"] {
  return ({ signedIn }) => (signedIn ? destination : null);
}

export const routeRedirects: readonly RouteRedirectRule[] = [
  // Area B (3.5.d).
  { path: "/", resolve: ({ signedIn }) => (signedIn ? "/home" : "/au") },
  // Area C (7.8.a).
  { path: "/business", resolve: movedToStudio("/studio") },
  { path: "/business/campaigns", resolve: movedToStudio("/studio/campaigns") },
  { path: "/business/inventory", resolve: movedToStudio("/studio/inventory") },
  // No redemptions zone exists in Studio (F40 moved it to 8.2.g) — the old
  // redemption tab was only ever a placeholder, so this sends a signed-in
  // visitor to the overview rather than a route that no longer exists.
  { path: "/business/redemption", resolve: movedToStudio("/studio") },
  { path: "/business/reports", resolve: movedToStudio("/studio/reports") },
  { path: "/business/team", resolve: movedToStudio("/studio/team") },
  { path: "/business/billing", resolve: movedToStudio("/studio/billing") },
];
