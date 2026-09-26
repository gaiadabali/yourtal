/**
 * A separate file for one Symbol, deliberately — `watch.module.ts` provides
 * it and `watch.controller.ts` injects it, and defining it in either of
 * those two files makes the other import it, which is a circular import
 * between a module and its own controller. That circularity is exactly
 * what left `@Inject(REWARD_ATTESTATION_SECRET)` decorating `undefined`
 * (NestJS then reports the parameter as unresolvable, showing `?` in its
 * error rather than the symbol) — the same reasoning `CHECKPOINT_SECRET`
 * already avoids by living in `checkpoint.service.ts`, a third file neither
 * of those two needs to import each other over.
 */
export const REWARD_ATTESTATION_SECRET = Symbol("REWARD_ATTESTATION_SECRET");
