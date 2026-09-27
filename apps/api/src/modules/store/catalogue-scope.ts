import type { Principal } from "@yourtal/authz/principal";
import { audienceSchema, reachesAudience } from "@yourtal/contracts/audience/audience";
import type { Audience } from "@yourtal/contracts/audience/audience";
import type { Region } from "@yourtal/contracts/region";

/**
 * 7.4.d (reopened): the public catalogue's region and audience floor come
 * from the CALLER, resolved exactly once here for both `browse` and `get`.
 *
 *  - Signed in: region is the principal's own `jurisdiction` and audiences
 *    are whatever `reachesAudience` admits for the principal's real
 *    `ageBand` -- NEVER the query string, which is why a `region` query
 *    param that disagrees with it is a mismatch, not an override.
 *  - Anonymous: region is the REQUIRED query param ("the path region" --
 *    there is no session to read one from), and audiences are `["all_ages"]`
 *    only, since there is no age band to reach anything wider.
 */
export type CatalogueScope =
  | { readonly kind: "ok"; readonly region: Region; readonly audiences: readonly Audience[] }
  /** A signed-in caller's own region does not match a `region` query param it also sent. */
  | { readonly kind: "region_mismatch" }
  /** An anonymous caller sent no `region` at all. */
  | { readonly kind: "anonymous_region_required" };

export function resolveCatalogueScope(
  principal: Principal,
  queryRegion: Region | undefined,
): CatalogueScope {
  if (principal.id === "anonymous") {
    if (queryRegion === undefined) return { kind: "anonymous_region_required" };
    return { kind: "ok", region: queryRegion, audiences: ["all_ages"] };
  }

  const region = principal.attr.jurisdiction;
  if (queryRegion !== undefined && queryRegion !== region) {
    return { kind: "region_mismatch" };
  }

  // AsyncPrincipalResolver always sets ageBand for a signed-in principal
  // (from identity.user_profile.date_of_birth); the schema still carries it
  // as optional (packages/authz/src/principal.ts), so this stays defensive
  // rather than asserting a fact that lives in a different package.
  const ageBand = principal.attr.ageBand;
  const audiences =
    ageBand === undefined
      ? (["all_ages"] as const)
      : audienceSchema.options.filter((candidate) => reachesAudience(candidate, { ageBand }));

  return { kind: "ok", region, audiences };
}
