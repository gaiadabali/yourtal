/**
 * Deterministic, non-cryptographic string hash (djb2 variant) used to turn an
 * arbitrary id into a mock-generator seed.
 *
 * This lives here, shared, because it carries a correctness invariant that a
 * copy-paste cannot hold: the player (`/watch/[campaignId]`) and the
 * checkpoint (`/watch/[campaignId]/checkpoint`) both synthesise a campaign
 * for an id that is not in the fixed mock catalogue, and they MUST land on
 * the same campaign. If they hash differently, the checkpoint shows different
 * reward figures than the player just promised — which is exactly what
 * YT-0411's "terms shown here are the terms honoured" forbids.
 *
 * Deliberately dependency-free (no Zod): it is imported by route-level data
 * modules, and a value import from a schema module would pull the Zod runtime
 * into a client bundle. See money-format.ts for the same reasoning.
 */
export function hashStringToSeed(value: string): number {
  let hash = 5_381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}
