/**
 * The Postgres pool `identity.credential`/`.session`/`.verification_token`
 * go through (see `auth.module.ts`'s own header for why this is a separate
 * `Pool` from `IdentityModule`'s `IDENTITY_DB`). Both are constructed from
 * the SAME `config.databaseUrl` — one physical database, two connection
 * pools — which is exactly what 2.5 (F31)'s atomic registration depends on:
 * `AuthService.register` opens one transaction on this pool and writes
 * `identity.credential` and, through `UserProfileRepository`'s own
 * transaction-aware `create`, `identity.user_profile` inside it.
 *
 * Its own file rather than living in `auth.module.ts` (where it lived before
 * 2.5) so `auth.service.ts` can `@Inject` it without importing the module
 * that in turn imports the service — a real circular import, not just an
 * awkward one, since `AUTH_DB`'s assignment would still be in the module's
 * own temporal dead zone the moment `AuthService`'s constructor decorator
 * evaluated it.
 */
export const AUTH_DB = Symbol("AUTH_DB");
