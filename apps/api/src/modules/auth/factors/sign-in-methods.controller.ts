import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import {
  RateLimit,
  SIGN_IN_METHOD_CHANGE_RATE_LIMIT,
} from "../../../shared/rate-limit/rate-limit.decorator";
import { hashOpaqueToken } from "../crypto/opaque-token";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { StepUpDto } from "./dto/sign-in-methods.dto";
import { STEP_UP_TTL_SECONDS } from "./factor-settings";
import { FACTOR_STORE } from "./factor-store";
import type { FactorStore } from "./factor-store";
import { PasskeyService } from "./passkey.service";
import { passkeySummary } from "./passkey-summary";
import { proveFactor } from "./prove-factor";
import { SignedInCaller } from "./signed-in-session";
import { mapFactorErrorToHttpException } from "./to-http-exception";
import { TotpService } from "./totp.service";

/**
 * The overview of how the caller's account signs in, and the step-up that
 * lets a session signed in with a password alone change it: proving an
 * existing passkey or authenticator code again, on this session only.
 */
@Controller("api/auth")
export class SignInMethodsController {
  constructor(
    private readonly caller: SignedInCaller,
    private readonly totp: TotpService,
    private readonly passkeys: PasskeyService,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(FACTOR_STORE) private readonly store: FactorStore,
  ) {}

  @NotValueMoving("A read of the caller's own sign-in methods.")
  @Authorize({ kind: "session", action: "view_sign_in_methods" })
  @Get("sign-in-methods")
  async signInMethods(@Req() request: FastifyRequest) {
    const caller = await this.caller.resolve(request, new Date(), "session");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId } = caller.value;
    const [password, passkeys, totpEnabled] = await Promise.all([
      this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND),
      this.passkeys.list(userId),
      this.totp.isEnabled(userId),
    ]);
    return {
      password: password !== null,
      passkeys: passkeys.map(passkeySummary),
      authenticatorApp: { enabled: totpEnabled, available: this.totp.available() },
    };
  }

  @NotValueMoving(
    "Marks this session as having just proved a factor, for a few minutes. A code is " +
      "accepted once and a passkey challenge answers once, so a retry is refused.",
  )
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("step-up")
  async stepUp(@Req() request: FastifyRequest, @Body() body: StepUpDto) {
    const now = new Date();
    const caller = await this.caller.resolve(request, now, "session");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId, sessionToken } = caller.value;
    const proved = await proveFactor(this.totp, this.passkeys, userId, body, now);
    if (proved.isErr()) throw mapFactorErrorToHttpException(proved.error);
    await this.store.grantStepUp(hashOpaqueToken(sessionToken), userId, STEP_UP_TTL_SECONDS);
    return { steppedUp: true, expiresInSeconds: STEP_UP_TTL_SECONDS };
  }
}
