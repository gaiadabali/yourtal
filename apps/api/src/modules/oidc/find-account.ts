import type { FindAccount, KoaContextWithOIDC } from "oidc-provider";
import { claimsFor } from "./claims";
import type { YourTalClient } from "./clients";
import { clientById, isSignInClient } from "./clients";
import type { OidcStore } from "./oidc-store";
import type { TeenInviteChecker } from "./sign-in-checks";
import { signInBlock } from "./sign-in-checks";

/**
 * The provider's `findAccount`, from YourTal's identity tables. The library
 * swaps `sub` for the pairwise identifier and keeps only the claims of the
 * granted scopes.
 *
 * It runs at resume, at the token endpoint and at userinfo, so it repeats the
 * docs/26 §1.5 checks for the client asking: an account that is gone,
 * unverified, on hold, in the wrong region or a refused teen issues nothing
 * (resume goes back to YourTal's screen, /token answers invalid_grant, /me
 * invalid_token).
 */
export function findAccountFrom(
  store: Pick<OidcStore, "findAccount">,
  clients: () => readonly YourTalClient[],
  teenInvites: TeenInviteChecker,
  now: () => Date = () => new Date(),
): FindAccount {
  return async (ctx, accountId) => {
    const client = clientById(clients(), clientIdOf(ctx) ?? "");
    if (client === undefined || !isSignInClient(client)) return undefined;
    const account = await store.findAccount(accountId);
    if (account === null) return undefined;
    const inviteCode = ctx.oidc.params?.["teen_invite"];
    const block = await signInBlock(
      account,
      client,
      teenInvites,
      typeof inviteCode === "string" ? inviteCode : undefined,
      now(),
    );
    if (block !== null) return undefined;
    return {
      accountId,
      claims: () => ({ sub: accountId, ...claimsFor(account, now()) }),
    };
  };
}

/** Typed as always there; a request with no client yet has none. */
function clientIdOf(ctx: KoaContextWithOIDC): string | undefined {
  return (ctx.oidc as { client?: { clientId: string } }).client?.clientId;
}
