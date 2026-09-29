/**
 * The Postgres pool every `identity.*` repository connects through. Its own
 * file rather than living in `identity.module.ts` — the same reason
 * `auth/persistence/auth-db.token.ts` gives for itself: `identity.module.ts`
 * now also declares `GuardianConsentController` (12.1.a), which needs to
 * `@Inject` this token, and a controller importing it FROM the module file
 * that in turn imports the controller is a real circular import — `IDENTITY_DB`'s
 * assignment would still be in the module's own temporal dead zone the
 * moment the controller's constructor decorator evaluated it.
 */
export const IDENTITY_DB = Symbol("IDENTITY_DB");
