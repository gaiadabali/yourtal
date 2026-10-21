import { Body, Controller, Delete, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import {
  PASSKEY_SIGN_IN_OPTIONS_RATE_LIMIT,
  PASSKEY_SIGN_IN_VERIFY_RATE_LIMIT,
  RateLimit,
  SIGN_IN_METHOD_CHANGE_RATE_LIMIT,
} from "../../../shared/rate-limit/rate-limit.decorator";
import { PASSKEY_AMR } from "../session/amr";
import { SessionIssuer } from "../session/session-issuer";
import { PasskeyRegisterDto, PasskeySignInDto } from "./dto/sign-in-methods.dto";
import { FACTOR_NOTIFIER } from "./factor-notifier";
import type { FactorNotifications } from "./factor-notifier";
import { PasskeyService } from "./passkey.service";
import { passkeySummary } from "./passkey-summary";
import { withinBootstrapWindow } from "./factor-settings";
import { SignedInCaller } from "./signed-in-session";
import { mapFactorErrorToHttpException } from "./to-http-exception";

/**
 * Passkeys. Signing in with one is for a signed-out caller and needs no email
 * first; the rest is the signed-in person managing their own. The PDP decides
 * who reaches each route (`session.yaml`); the account a route acts on is
 * always the caller's own session, never an id from the request. Adding one
 * to an account that already has a factor, and removing one, need proof of a
 * factor (`SignedInCaller`), and both are emailed to the account.
 */
@Controller("api/auth/passkeys")
export class PasskeyController {
  constructor(
    private readonly passkeys: PasskeyService,
    private readonly caller: SignedInCaller,
    private readonly issuer: SessionIssuer,
    @Inject(FACTOR_NOTIFIER) private readonly notifier: FactorNotifications,
  ) {}

  @NotValueMoving("Mints a single-use challenge and changes nothing else.")
  @RateLimit(PASSKEY_SIGN_IN_OPTIONS_RATE_LIMIT)
  @Authorize({ kind: "session", action: "create_with_passkey" })
  @Post("sign-in/options")
  async signInOptions() {
    const result = await this.passkeys.signInOptions();
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving(
    "Creates a session, like a password login. The challenge is taken before the " +
      "response is checked, so a retry of the same answer is refused.",
  )
  @RateLimit(PASSKEY_SIGN_IN_VERIFY_RATE_LIMIT)
  @Authorize({ kind: "session", action: "create_with_passkey" })
  @Post("sign-in")
  async signIn(@Body() body: PasskeySignInDto) {
    const now = new Date();
    const proved = await this.passkeys.signIn(
      body.challengeId,
      body.response as AuthenticationResponseJSON,
      now,
    );
    if (proved.isErr()) throw mapFactorErrorToHttpException(proved.error);
    const token = await this.issuer.issue(proved.value, now, PASSKEY_AMR);
    return { token, userId: proved.value };
  }

  @NotValueMoving("Mints a single-use challenge for the caller's own account.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("register/options")
  async registrationOptions(@Req() request: FastifyRequest) {
    const caller = await this.caller.resolve(request, new Date(), "add_factor");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const result = await this.passkeys.registrationOptions(caller.value.userId);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return { options: result.value };
  }

  @NotValueMoving(
    "The registration challenge is single-use, and a credential id can be stored once, " +
      "so a retry is refused rather than adding a second passkey.",
  )
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("register")
  async register(@Req() request: FastifyRequest, @Body() body: PasskeyRegisterDto) {
    const caller = await this.caller.resolve(request, new Date(), "add_factor");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId } = caller.value;
    const response = body.response as RegistrationResponseJSON;
    const result = await this.passkeys.register(
      userId,
      response,
      body.name,
      caller.value.bootstrapping,
    );
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    await this.notifier.notify(userId, { kind: "passkey_added", name: result.value.name });
    return passkeySummary(result.value);
  }

  @NotValueMoving("Mints a single-use challenge for the caller's own passkeys.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("step-up/options")
  async stepUpOptions(@Req() request: FastifyRequest) {
    const caller = await this.caller.resolve(request, new Date(), "session");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const result = await this.passkeys.stepUpOptions(caller.value.userId);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving("Removing an already-removed passkey is a 404, never a second change.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Delete(":credentialId")
  async remove(@Req() request: FastifyRequest, @Param("credentialId") credentialId: string) {
    const now = new Date();
    const who = await this.caller.resolve(request, now, "session");
    if (who.isErr()) throw mapFactorErrorToHttpException(who.error);
    const own = await this.passkeys.list(who.value.userId);
    const target = own.find((passkey) => passkey.credentialId === credentialId) ?? null;
    const caller = await this.caller.resolve(request, now, "strong", {
      emailProofRemoves:
        target !== null && withinBootstrapWindow(target.bootstrapped, target.createdAt, now),
    });
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId } = caller.value;
    const name = target?.name;
    const result = await this.passkeys.remove(userId, credentialId);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    await this.notifier.notify(userId, { kind: "passkey_removed", name: name ?? "Passkey" });
    return { removed: true };
  }
}
