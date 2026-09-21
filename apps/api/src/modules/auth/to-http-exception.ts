import {
  ConflictException,
  HttpException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  ChangePasswordError,
  ConfirmEmailVerificationError,
  ConfirmPasswordResetError,
  LoginError,
  RegisterError,
  RequestEmailVerificationError,
  RequestPasswordResetError,
} from "./auth.errors";

const logger = new Logger("AuthErrorMapper");

/**
 * The one adapter for this module's domain errors (docs/13b section 4),
 * matching `apps/api/src/modules/business/to-http-exception.ts`'s
 * convention. `AuthzError` from the PDP has its own mapper
 * (`shared/authz/authz-error.mapper.ts`) and is never combined with this
 * one, for the same reason the business module keeps the two apart.
 */
export type AuthDomainError =
  | RegisterError
  | LoginError
  | ChangePasswordError
  | RequestPasswordResetError
  | ConfirmPasswordResetError
  | RequestEmailVerificationError
  | ConfirmEmailVerificationError;

export function mapAuthErrorToHttpException(error: AuthDomainError): HttpException {
  switch (error.type) {
    case "email_already_registered":
      return new ConflictException({
        code: "email_already_registered",
        message: "an account with this email already exists",
      });
    case "invalid_credentials":
      // Deliberately the exact same status, code and message whether the
      // email does not exist or the password is wrong. See
      // `InvalidCredentialsError`'s own doc comment.
      return new UnauthorizedException({
        code: "invalid_credentials",
        message: "incorrect email or password",
      });
    case "throttled":
      return new HttpException(
        {
          code: "throttled",
          message: "too many attempts; try again later",
          retryAfterSeconds: error.retryAfterSeconds,
        },
        429,
      );
    case "session_invalid":
      return new UnauthorizedException({
        code: "session_invalid",
        message: "sign in again to continue",
      });
    case "token_invalid":
      // Collapses `not_found`/`already_consumed`/`expired` — see the type's
      // own doc comment for why a caller must not be able to tell them
      // apart.
      return new UnauthorizedException({
        code: "token_invalid",
        message: "this link is invalid or has expired",
      });
    case "persistence_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException({
        code: "persistence_unavailable",
        message: "the request could not be completed",
      });
    default: {
      // docs/13b section 4: a `never` default so a new error variant fails
      // this file to compile rather than falling through silently.
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
