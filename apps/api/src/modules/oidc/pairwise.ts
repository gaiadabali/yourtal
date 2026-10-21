import { randomBytes } from "node:crypto";
import type { YourTalClient } from "./clients";
import { clientById } from "./clients";
import type { OidcStore } from "./oidc-store";

/**
 * A new pairwise `sub`: 128 random bits as 22 characters of base64url
 * (docs/26 §1.2). Random and stored, never derived from the user id, so there
 * is no secret to rotate and erasing the row ends the link for good.
 */
export function randomSubject(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The provider's `pairwiseIdentifier` hook. The sector comes from YourTal's
 * registry, not the library's redirect-host sector, so an app's web, phone and
 * server clients share one `sub`.
 *
 * A sub is only made when one is handed to the app (`create`: the ID token or
 * userinfo). Anywhere else the library asks only to compare, so an existing
 * sub is read back and a person who never used the app gets a throwaway value
 * that matches nothing and is never stored.
 */
export function pairwiseIdentifierFor(
  store: Pick<OidcStore, "subjectFor" | "findSubject">,
  clients: readonly YourTalClient[],
): (accountId: string, clientId: string, create: boolean) => Promise<string> {
  return async (accountId, clientId, create) => {
    const client = clientById(clients, clientId);
    if (client === undefined) throw new Error(`oidc: no sector for client ${clientId}`);
    if (create) return store.subjectFor(client.sector, accountId, randomSubject);
    return (await store.findSubject(client.sector, accountId)) ?? randomSubject();
  };
}
