import { Body, Controller, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import {
  CHANGE_PASSWORD_RETENTION_MS,
  CONFIRM_EMAIL_VERIFICATION_RETENTION_MS,
  CONFIRM_PASSWORD_RESET_RETENTION_MS,
  REGISTER_RETENTION_MS,
} from "./idempotency-retention";
import { AuthService } from "./auth.service";
import { bearerToken } from "./bearer-token";
import { mapAuthErrorToHttpException } from "./to-http-exception";
import { RegisterDto } from "./dto/register.schema";
import { LoginDto } from "./dto/login.schema";
import { ChangePasswordDto } from "./dto/change-password.schema";
import { RequestPasswordResetDto } from "./dto/request-password-reset.schema";
import { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.schema";
import { ConfirmEmailVerificationDto } from "./dto/confirm-email-verification.schema";

/**
 * Email and password authentication. YT-0540.
 *
 * No `:tenantId` — `CLAUDE.md`'s `/api/:tenantId/*` convention does not
 * apply here, matching `create-business.controller.ts`'s own precedent:
 * these routes are about an account, not a business, and most of them are
 * asked before any tenant is known at all.
 *
 * Every route below asks the PDP a `session:*` question (YT-0500's rule:
 * no route decides authorization for itself) — see
 * `policies/resource_policies/session.yaml` for what each answers and,
 * importantly, for the boundary it deliberately does NOT cross (`admin`
 * appears in none of those rules; see this ticket's report). That PDP
 * check answers "may a principal of this SHAPE reach this action at all".
 * It is coarse by construction — there is no tenant or object instance to
 * scope against, unlike almost every other resource kind in this repo —
 * and it is not what proves a caller IS the account they claim: that is
 * `AuthService`'s job, checking an Argon2id hash or a hashed session/
 * token lookup, which is real cryptographic proof rather than a role
 * check. The PDP question and the identity proof are deliberately
 * different mechanisms answering different questions, the same split
 * `PdpGuard` and `AsyncPrincipalResolver`'s own doc comments describe for
 * every other route in this app.
 */
@Controller("api/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Idempotent({ retentionMs: REGISTER_RETENTION_MS })
  @Authorize({ kind: "session", action: "register" })
  @Post("register")
  async register(@Body() body: RegisterDto) {
    const result = await this.auth.register(body.email, body.password);
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { userId: result.value.userId };
  }

  @NotValueMoving(
    "Creates a session, not a value record. A retried login is either " +
      "refused identically (wrong credentials twice) or mints a second, " +
      "independently revocable session for the same account — never a " +
      "double-spend of anything the ledger or a merchant would notice. " +
      "The account-and-source throttle in identity.session's write path " +
      "already bounds how many attempts a retry storm can cost.",
  )
  @Authorize({ kind: "session", action: "create" })
  @Post("login")
  async login(@Body() body: LoginDto, @Req() request: FastifyRequest) {
    const result = await this.auth.login(body.email, body.password, request.ip, new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { token: result.value.token, userId: result.value.userId };
  }

  @NotValueMoving(
    "Revoking a session is idempotent by construction — revoking an " +
      "already-revoked or unknown session changes nothing, so a retry " +
      "has nothing new to duplicate.",
  )
  @Authorize({ kind: "session", action: "delete" })
  @Post("logout")
  async logout(@Req() request: FastifyRequest) {
    const result = await this.auth.logout(bearerToken(request), new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { loggedOut: true };
  }

  @Idempotent({ retentionMs: CHANGE_PASSWORD_RETENTION_MS })
  @Authorize({ kind: "session", action: "change_password" })
  @Post("password/change")
  async changePassword(@Body() body: ChangePasswordDto, @Req() request: FastifyRequest) {
    const result = await this.auth.changePassword(
      bearerToken(request),
      body.currentPassword,
      body.newPassword,
      new Date(),
    );
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { token: result.value.token };
  }

  @NotValueMoving(
    "Always reports success and, when the email is unregistered, does " +
      "nothing at all — see AuthService.requestPasswordReset. At most a " +
      "retry issues a second valid, independently-expiring token; nothing " +
      "outstanding is invalidated or duplicated in a way a caller would " +
      "notice.",
  )
  @Authorize({ kind: "session", action: "request_password_reset" })
  @Post("password/reset/request")
  async requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    const result = await this.auth.requestPasswordReset(body.email, new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { requested: true };
  }

  @Idempotent({ retentionMs: CONFIRM_PASSWORD_RESET_RETENTION_MS })
  @Authorize({ kind: "session", action: "confirm_password_reset" })
  @Post("password/reset/confirm")
  async confirmPasswordReset(@Body() body: ConfirmPasswordResetDto) {
    const result = await this.auth.confirmPasswordReset(body.token, body.newPassword, new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { token: result.value.token };
  }

  @NotValueMoving(
    "Issues a verification token; nothing about the account changes " +
      "until the token is confirmed, and a retry issuing a second live " +
      "token is harmless for the same reason a second password-reset " +
      "token is.",
  )
  @Authorize({ kind: "session", action: "request_email_verification" })
  @Post("email/verify/request")
  async requestEmailVerification(@Req() request: FastifyRequest) {
    const result = await this.auth.requestEmailVerification(bearerToken(request), new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { requested: true };
  }

  @Idempotent({ retentionMs: CONFIRM_EMAIL_VERIFICATION_RETENTION_MS })
  @Authorize({ kind: "session", action: "confirm_email_verification" })
  @Post("email/verify/confirm")
  async confirmEmailVerification(@Body() body: ConfirmEmailVerificationDto) {
    const result = await this.auth.confirmEmailVerification(body.token, new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { verified: true };
  }
}
