import { Body, Controller, ForbiddenException, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import {
  EMAIL_VERIFY_REQUEST_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  PASSWORD_RESET_REQUEST_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
  RateLimit,
} from "../../shared/rate-limit/rate-limit.decorator";
import {
  CONFIRM_EMAIL_VERIFICATION_RETENTION_MS,
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
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 1.4.b's under-13 refusal has to be neutral even under retry: a caller
   * that resubmits with a slightly different date of birth must not be able
   * to bisect its way to the exact boundary by watching the response change.
   * `yt_signup_blocked` is set for 24h the first time this refusal fires and
   * checked before `AuthService` (or the idempotency store, or the rate
   * limiter's Argon2id-adjacent cost) ever sees a submitted date of birth
   * again — a plain header, not `@fastify/cookie`: this is the one place in
   * the app that needs a cookie today, and the real session cookie (1.5.a)
   * is a separate mechanism with its own signing/expiry story.
   */
  @RateLimit(REGISTER_RATE_LIMIT)
  @Idempotent({ retentionMs: REGISTER_RETENTION_MS, redact: withoutToken })
  @Authorize({ kind: "session", action: "register" })
  @Post("register")
  async register(
    @Body() body: RegisterDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (isSignupBlocked(request)) {
      throw tooYoungException();
    }

    const result = await this.auth.register(
      body.email,
      body.password,
      {
        region: body.region,
        locale: body.locale,
        displayName: body.displayName,
        dateOfBirth: body.dateOfBirth,
        timezone: body.timezone,
        ...(body.guardianEmail === undefined ? {} : { guardianEmail: body.guardianEmail }),
      },
      new Date(),
    );

    if (result.isErr()) {
      if (result.error.type === "too_young") {
        reply.header(
          "set-cookie",
          `${SIGNUP_BLOCKED_COOKIE}=1; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax${secureCookieSuffix(this.config)}`,
        );
      }
      throw mapAuthErrorToHttpException(result.error);
    }
    return { userId: result.value.userId, token: result.value.token };
  }

  @NotValueMoving(
    "Creates a session, not a value record. A retried login is either " +
      "refused identically (wrong credentials twice) or mints a second, " +
      "independently revocable session for the same account — never a " +
      "double-spend of anything the ledger or a merchant would notice. " +
      "The account-and-source throttle in identity.session's write path " +
      "already bounds how many attempts a retry storm can cost.",
  )
  @RateLimit(LOGIN_RATE_LIMIT)
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

  @NotValueMoving(
    "1.5.f: was @Idempotent, which stored this route's {token} reply — a " +
      "live, directly-usable session credential — in plaintext in " +
      "platform.idempotency, a table readable by more than this module " +
      "(docs/audit/2026-09-25/api-backend.md section 8). changePassword " +
      "revokes every session for this user, INCLUDING the one authenticating " +
      "the call that is running right now, before issuing the replacement — " +
      "so a retry that reuses the same (now-revoked) bearer token fails with " +
      "session_invalid rather than re-applying the change or re-revoking " +
      "anything a second time. The cost is a client that never saw its own " +
      "success has to log in again instead of replaying the old response; " +
      "the alternative was a working credential sitting in a shared table.",
  )
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
  @RateLimit(PASSWORD_RESET_REQUEST_RATE_LIMIT)
  @Post("password/reset/request")
  async requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    const result = await this.auth.requestPasswordReset(body.email, new Date());
    if (result.isErr()) throw mapAuthErrorToHttpException(result.error);
    return { requested: true };
  }

  @NotValueMoving(
    "1.5.f: was @Idempotent, for the same reason changePassword's own note " +
      "gives — this route's {token} reply is a live session credential, and " +
      "@Idempotent stored it in plaintext in platform.idempotency " +
      "(docs/audit/2026-09-25/api-backend.md section 8). The reset token " +
      "itself is single-use (VerificationTokenRepository.consume marks it " +
      "spent), so a retry with the SAME token after a successful confirm " +
      "gets token_invalid rather than reapplying the reset or reissuing a " +
      "second session for it.",
  )
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
  @RateLimit(EMAIL_VERIFY_REQUEST_RATE_LIMIT)
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

const SIGNUP_BLOCKED_COOKIE = "yt_signup_blocked";

/**
 * A minimal, single-purpose read — not a general cookie parser. Looks for
 * exactly `yt_signup_blocked=1` in the raw `Cookie` header, which is all
 * this one check needs; a real cookie-jar (1.5.a's `yt_session`) is a
 * separate, later mechanism with its own signing and expiry.
 */
function isSignupBlocked(request: FastifyRequest): boolean {
  const raw = request.headers.cookie;
  if (raw === undefined) return false;
  return raw
    .split(";")
    .map((part) => part.trim())
    .includes(`${SIGNUP_BLOCKED_COOKIE}=1`);
}

/** Same neutral shape `mapAuthErrorToHttpException` builds for a fresh `too_young` refusal. */
function tooYoungException(): ForbiddenException {
  return new ForbiddenException({ code: "too_young", message: "You can't create an account yet." });
}

/**
 * 1.5.f: `register`'s `IdempotentOptions.redact` — strips `token` from what
 * `platform.idempotency` ever stores (and so from what a REPLAY can ever
 * return), while the caller who actually just registered still gets the
 * full `{ userId, token }` reply unchanged (`redact` never runs on that
 * response, only on the copy persisted for a future replay). A replay
 * therefore proves "this email is already registered, here is its
 * userId" — enough to confirm success without re-issuing a live session
 * for a caller who never proved they still hold the original request.
 */
function withoutToken(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "token" in value) {
    const { token: _token, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

/**
 * 1.5.e: `; Secure` for every cookie this API sets, except in dev — the
 * same gate `apps/web/lib/api/session-cookies.ts` already uses
 * (`secure: process.env.NODE_ENV === "production"`) for the web-set
 * `yt_session`/`yt_locale`/`yt_region` cookies, so the one cookie the API
 * itself sets (`yt_signup_blocked`) does not disagree with them. A plain
 * `docker-compose` dev boot has no TLS in front of it, and `Secure` on an
 * HTTP-only connection makes a browser refuse to store the cookie at all,
 * silently — never a security improvement to fail dev with.
 */
function secureCookieSuffix(config: AppConfig): string {
  return config.nodeEnv === "production" ? "; Secure" : "";
}
