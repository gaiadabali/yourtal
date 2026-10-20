import type { FindAccount } from "oidc-provider";
import { claimsFor } from "./claims";
import type { OidcStore } from "./oidc-store";

/**
 * The provider's `findAccount`, from YourTal's identity tables. The library
 * swaps `sub` for the pairwise identifier and keeps only the claims of the
 * granted scopes. An account that no longer exists issues nothing.
 */
export function findAccountFrom(
  store: Pick<OidcStore, "findAccount">,
  now: () => Date = () => new Date(),
): FindAccount {
  return async (_ctx, accountId) => {
    const account = await store.findAccount(accountId);
    if (account === null) return undefined;
    return {
      accountId,
      claims: () => ({ sub: accountId, ...claimsFor(account, now()) }),
    };
  };
}
