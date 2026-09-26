/**
 * A separate file for one Symbol, same reasoning as
 * `reward-attestation-secret.ts`: `watch.module.ts` provides it and
 * `watch.controller.ts` injects it, and defining it in either of those two
 * files makes the other import it — a circular import between a module and
 * its own controller.
 */
export const MANIFEST_SIGNING_SECRET = Symbol("MANIFEST_SIGNING_SECRET");
