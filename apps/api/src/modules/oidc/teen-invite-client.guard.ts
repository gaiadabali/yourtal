import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MachineClient } from "./clients";
import { clientById } from "./clients";
import { OIDC_RUNTIME, OidcRuntime } from "./oidc-runtime";

/** Read by `IdempotencyInterceptor` (`scopeBy: "oidc_client"`) by this plain name. */
export const VERIFIED_OIDC_CLIENT_KEY = "verifiedOidcClientId";
export const TEEN_INVITES_SCOPE = "teen_invites";

/**
 * docs/26 §3.3: the teen invite API takes only a client-credentials access
 * token with scope `teen_invites`, looked up in the provider in this process.
 * A guard, so it runs before the idempotency interceptor, as
 * PartnerAuthGuard does. An ID token or a person's access token is not a
 * ClientCredentials record, so it is never found here.
 */
@Injectable()
export class TeenInviteClientGuard implements CanActivate {
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
    if (
      !scopes.includes(TEEN_INVITES_SCOPE) ||
      !client.allowedScopes.includes(TEEN_INVITES_SCOPE)
    ) {
      throw new ForbiddenException({
        code: "insufficient_scope",
        message: "the token lacks the teen_invites scope",
      });
    }
    Reflect.set(request, VERIFIED_OIDC_CLIENT_KEY, client.clientId);
    return true;
  }
}

/** The client the guard verified; never re-verifies. */
export function verifiedClient(request: FastifyRequest, runtime: OidcRuntime): MachineClient {
  const clientId: unknown = Reflect.get(request, VERIFIED_OIDC_CLIENT_KEY);
  const client = typeof clientId === "string" ? clientById(runtime.clients, clientId) : undefined;
  if (client?.kind !== "machine") {
    throw new UnauthorizedException({ code: "invalid_token", message: "no verified client" });
  }
  return client;
}
