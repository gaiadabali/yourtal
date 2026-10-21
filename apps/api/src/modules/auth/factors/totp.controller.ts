import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import {
  RateLimit,
  SIGN_IN_METHOD_CHANGE_RATE_LIMIT,
  TOTP_SIGN_IN_RATE_LIMIT,
} from "../../../shared/rate-limit/rate-limit.decorator";
import { hashOpaqueToken } from "../crypto/opaque-token";
import { SessionService } from "../session/session.service";
import { TotpCodeDto, TotpDisableDto, TotpSignInDto } from "./dto/sign-in-methods.dto";
import { FACTOR_NOTIFIER } from "./factor-notifier";
import { FactorWindow } from "./factor-window";
import type { FactorNotifications } from "./factor-notifier";
import { PasskeyService } from "./passkey.service";
import { proveFactor } from "./prove-factor";
import { SecondFactorGate } from "./second-factor-gate";
import { SignedInCaller } from "./signed-in-session";
import { mapFactorErrorToHttpException } from "./to-http-exception";
import { TotpService } from "./totp.service";

/**
 * Authenticator-app codes. The account is always the caller's own session;
 * the code step after a password is the one signed-out route, and its
 * pending token is what names the account. Every change is emailed to the
 * account's own address.
 */
@Controller("api/auth/totp")
export class TotpController {
  constructor(
    private readonly totp: TotpService,
    private readonly passkeys: PasskeyService,
    private readonly gate: SecondFactorGate,
    private readonly sessions: SessionService,
    private readonly caller: SignedInCaller,
    @Inject(FACTOR_NOTIFIER) private readonly notifier: FactorNotifications,
    private readonly window: FactorWindow,
  ) {}

  @NotValueMoving(
    "Replaces an unfinished enrolment's seed; a retry just shows a newer QR code. " +
      "A switched-on app is never replaced from here.",
  )
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("enrol")
  async enrol(@Req() request: FastifyRequest) {
    if (!this.totp.available()) {
      throw mapFactorErrorToHttpException({ type: "authenticator_unavailable" });
    }
    const caller = await this.caller.resolve(request, new Date(), "add_factor");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId, sessionToken } = caller.value;
    const result = await this.totp.enrol(userId, hashOpaqueToken(sessionToken));
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }

  @NotValueMoving("A code is accepted once; a retry is refused as already set up.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("confirm")
  async confirm(@Req() request: FastifyRequest, @Body() body: TotpCodeDto) {
    const now = new Date();
    // The same check as enrolling: a session that could not add a factor
    // cannot finish adding one either.
    const caller = await this.caller.resolve(request, now, "add_factor");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId, sessionToken, firstFactor } = caller.value;
    const sessionHash = hashOpaqueToken(sessionToken);
    const result = await this.totp.confirm(userId, sessionHash, body.code, now);
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    if (firstFactor) await this.window.openForFirstFactor(userId, now);
    // Sessions signed in elsewhere with the password alone end here: from now
    // on a password sign-in also needs a code.
    await this.sessions.revokeOthers(userId, sessionToken, now);
    await this.notifier.notify(userId, { kind: "authenticator_on" });
    return { enabled: true };
  }

  @NotValueMoving("Turning off an app that is already off is refused, never repeated.")
  @RateLimit(SIGN_IN_METHOD_CHANGE_RATE_LIMIT)
  @Authorize({ kind: "session", action: "manage_sign_in_methods" })
  @Post("disable")
  async disable(@Req() request: FastifyRequest, @Body() body: TotpDisableDto) {
    const now = new Date();
    const caller = await this.caller.resolve(request, now, "session");
    if (caller.isErr()) throw mapFactorErrorToHttpException(caller.error);
    const { userId, sessionToken } = caller.value;
    if (!(await this.totp.isEnabled(userId))) {
      throw mapFactorErrorToHttpException({ type: "totp_not_enabled" });
    }
    // A live session is not enough: a code from the app, or a passkey, proves
    // the person at the keyboard still holds a second factor.
    const proved = await proveFactor(this.totp, this.passkeys, userId, body, now);
    if (proved.isErr()) throw mapFactorErrorToHttpException(proved.error);
    const removed = await this.totp.remove(userId);
    if (removed.isErr()) throw mapFactorErrorToHttpException(removed.error);
    // Sessions elsewhere end too, so turning a planted app off is not raced.
    await this.sessions.revokeOthers(userId, sessionToken, now);
    await this.window.closeIfNoFactors(userId);
    await this.notifier.notify(userId, { kind: "authenticator_off" });
    return { enabled: false };
  }

  @NotValueMoving(
    "Creates a session, like a password login. The pending token is dropped on success " +
      "and the code's time step is used up, so a retry is refused.",
  )
  @RateLimit(TOTP_SIGN_IN_RATE_LIMIT)
  @Authorize({ kind: "session", action: "complete_second_factor" })
  @Post("sign-in")
  async signIn(@Body() body: TotpSignInDto) {
    const result = await this.gate.completeWithTotp(body.pendingToken, body.code, new Date());
    if (result.isErr()) throw mapFactorErrorToHttpException(result.error);
    return result.value;
  }
}
