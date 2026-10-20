import type Provider from "oidc-provider";
import type { KoaContextWithOIDC } from "oidc-provider";
import type { OidcStore } from "./oidc-store";

/** docs/26 §1.8: the JWKS is cacheable for 10 minutes and discovery for 1 hour. */
export const JWKS_MAX_AGE = 10 * 60;
export const DISCOVERY_MAX_AGE = 60 * 60;

/**
 * What YourTal adds around the library's own routes, after they answer:
 * cache lifetimes on the keys and discovery, and a sign-in log row for each
 * code issued, which is the moment a sign-in is complete. Awaited before the
 * response goes, so the row is there when the app redeems the code.
 */
export function addProviderMiddleware(
  provider: Provider,
  store: Pick<OidcStore, "logSignIn"> | null,
  onError: (message: string) => void,
): void {
  provider.use(async (koa, next) => {
    await next();
    if (koa.status === 200 && koa.path === "/jwks") {
      koa.set("cache-control", `public, max-age=${String(JWKS_MAX_AGE)}`);
    } else if (koa.status === 200 && koa.path.startsWith("/.well-known/")) {
      koa.set("cache-control", `public, max-age=${String(DISCOVERY_MAX_AGE)}`);
    }

    // The library sets ctx.oidc on its own routes only; Koa's types do not know it.
    const oidc = (koa as { oidc?: KoaContextWithOIDC["oidc"] }).oidc;
    const code = oidc?.route === "resume" ? oidc.entities.AuthorizationCode : undefined;
    if (store === null || code?.accountId === undefined || code.clientId === undefined) return;
    try {
      await store.logSignIn(code.accountId, code.clientId, "signed_in");
    } catch (error) {
      onError(`sign-in log write failed: ${error instanceof Error ? error.message : "error"}`);
    }
  });
}
