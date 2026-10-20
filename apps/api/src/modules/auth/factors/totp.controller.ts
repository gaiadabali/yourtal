import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import {
  RateLimit,
  SIGN_IN_METHOD_CHANGE_RATE_LIMIT,
  TOTP_SIGN_IN_RATE_LIMIT,
} from "../../../shared/rate-limit/rate-limit.decorator";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import type { CredentialRepository } from "../persistence/credential.repository";
import { SessionService } from "../session/session.service";
import { TotpCodeDto, TotpDisableDto, TotpSignInDto } from "./dto/sign-in-methods.dto";
import { PasskeyService } from "./passkey.service";
import { passkeySummary } from "./passkey-summary";
import { SecondFactorGate } from "./second-factor-gate";
import { signedInUser } from "./signed-in-session";
import type { FactorError } from "./factor.errors";
import { mapFactorErrorToHttpException } from "./to-http-exception";
import { TotpService } from "./totp.service";

/**
 * Authenticator-app codes, and the overview of how an account signs in. The
 * account is always the caller's own session; the code step after a password
 * is the one signed-out route, and its pending token is what names the account.
 */
@Controller("api/auth")
export class TotpController {
  constructor(
    private readonly totp: TotpService,
    private readonly passkeys: PasskeyService,
    private readonly gate: SecondFactorGate,
    private readonly sessions: SessionService,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
  ) {}

  @NotValueMoving("A read of the caller's own sign-in methods.")
  @Authorize({ kind: "session", action: "view_sign_in_methods" })
  @Get("sign-in-methods")
  async signInMethods(@Req() request: FastifyRequest) {
    const userId = await signedInUser(this.sessions, request, new Date(), { fresh: false });
    if (userId.isErr()) throw mapFactorErrorToHttpException(userId.error);
    const [password, passkeys, totpEnabled] = await Promise.all([
      this.credentials.findByUserAndKind(userId.value, PASSWORD_CREDENTIAL_KIND),
      this.passkeys.list(userId.value),
      this.totp.isEnabled(userId.value),
    ]);
    return {
      password: password !== null,
      passkeys: passkeys.map(passkeySummary),
      authenticatorApp: { enabled: totpEnabled },
    };
  }

  @NotValueMoving(
    "Replaces an unfinished enrolment's seed; a retry just shows a newer QR code. " +
      "A switched-on app is never replaced from here.",
  )
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("totp/enrol")
  async enrol(@Req() request: FastifyRequest) {
    const userId = await signedInUser(this.sessions, request, new Date(), { fresh: true });
    if (userId.isErr()) throw mapFactorErrorToHttpException(userId.error);
    const result = await this.totp.enrol(userId.value);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving("A code is accepted once; a retry is refused as already set up.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("totp/confirm")
  async confirm(@Req() request: FastifyRequest, @Body() body: TotpCodeDto) {
    const now = new Date();
    const userId = await signedInUser(this.sessions, request, now, { fresh: false });
    if (userId.isErr()) throw mapFactorErrorToHttpException(userId.error);
    const result = await this.totp.confirm(userId.value, body.code, now);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return { enabled: true };
  }

  @NotValueMoving("Turning off an app that is already off is refused, never repeated.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("totp/disable")
  async disable(@Req() request: FastifyRequest, @Body() body: TotpDisableDto) {
    const now = new Date();
    const userId = await signedInUser(this.sessions, request, now, { fresh: false });
    if (userId.isErr()) throw mapFactorErrorToHttpException(userId.error);
    if (!(await this.totp.isEnabled(userId.value))) {
      throw mapFactorErrorToHttpException({ type: "totp_not_enabled" });
    }
    const proved = await this.proveSecondFactor(userId.value, body, now);
    if (proved.isErr()) throw mapFactorErrorToHttpException(proved.error);
    const removed = await this.totp.remove(userId.value);
    if (removed.isErr()) throw mapFactorErrorToHttpException(removed.error);
    return { enabled: false };
  }

  @NotValueMoving(
    "Creates a session, like a password login. The pending token is dropped on success " +
      "and the code's time step is claimed, so a retry is refused.",
  )
  @RateLimit(TOTP_SIGN_IN_RATE_LIMIT)
  @Authorize({ kind: "session", action: "complete_second_factor" })
  @Post("totp/sign-in")
  async signIn(@Body() body: TotpSignInDto) {
    const result = await this.gate.completeWithTotp(body.pendingToken, body.code, new Date());
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }

  /**
   * A live session is not enough to turn the app off: a code from it, or one
   * of the account's passkeys, proves the person still holds a second factor.
   */
  private async proveSecondFactor(
    userId: string,
    body: TotpDisableDto,
    now: Date,
  ): Promise<Result<unknown, FactorError>> {
    if (body.code !== undefined) return this.totp.verify(userId, body.code, now);
    if (body.challengeId !== undefined && body.response !== undefined) {
      const response = body.response as AuthenticationResponseJSON;
      return this.passkeys.stepUp(userId, body.challengeId, response, now);
    }
    return err({ type: "factor_invalid" });
  }
}
