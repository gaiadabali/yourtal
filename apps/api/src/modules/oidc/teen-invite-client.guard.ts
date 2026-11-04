import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  mixin,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext, Type } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MachineClient } from "./clients";
import { clientById } from "./clients";
import { OIDC_RUNTIME, OidcRuntime } from "./oidc-runtime";

/** Read by `IdempotencyInterceptor` (`scopeBy: "oidc_client"`) by this plain name. */
export const VERIFIED_OIDC_CLIENT_KEY = "verifiedOidcClientId";
export const TEEN_INVITES_SCOPE = "teen_invites";
export const APP_TRANSFERS_SCOPE = "app_transfers";

/**
 * docs/26 §3.3, docs/30 §5: the client APIs take only a client-credentials
 * access token with the given scope, looked up in the provider in this
 * process. A guard, so it runs before the idempotency interceptor, as
 * PartnerAuthGuard does. An ID token or a person's access token is not a
 * ClientCredentials record, so it is never found here.
 */
export function OidcClientGuard(scope: string): Type<CanActivate> {
  @Injectable()
  class ScopedClientGuard implements CanActivate {
    constructor(@Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<FastifyRequest>();
      const { provider } = this.runtime;
      if (provider === null) {
        throw new NotFoundException({ code: "not_found", message: "sign in with YourTal is off" });
      }
      const header = request.headers.authorization ?? "";
      const token = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header)?.[1];
      const found = token === undefined ? undefined : await provider.ClientCredentials.find(token);
      const client =
        found === undefined ? undefined : clientById(this.runtime.clients, found.clientId ?? "");
      if (found === undefined || client?.kind !== "machine") {
        throw new UnauthorizedException({
          code: "invalid_token",
          message: "a client-credentials access token is required",
        });
      }
      const scopes = (found.scope ?? "").split(" ");
      if (!scopes.includes(scope) || !client.allowedScopes.includes(scope)) {
        throw new ForbiddenException({
          code: "insufficient_scope",
          message: `the token lacks the ${scope} scope`,
        });
      }
      Reflect.set(request, VERIFIED_OIDC_CLIENT_KEY, client.clientId);
      return true;
    }
  }
  return mixin(ScopedClientGuard);
}

export const TeenInviteClientGuard = OidcClientGuard(TEEN_INVITES_SCOPE);
export const TransferClientGuard = OidcClientGuard(APP_TRANSFERS_SCOPE);

/** The client the guard verified; never re-verifies. */
export function verifiedClient(request: FastifyRequest, runtime: OidcRuntime): MachineClient {
  const clientId: unknown = Reflect.get(request, VERIFIED_OIDC_CLIENT_KEY);
  const client = typeof clientId === "string" ? clientById(runtime.clients, clientId) : undefined;
  if (client?.kind !== "machine") {
    throw new UnauthorizedException({ code: "invalid_token", message: "no verified client" });
  }
  return client;
}
