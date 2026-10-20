import type { HttpException } from "@nestjs/common";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { mapAuthErrorToHttpException } from "../to-http-exception";
import type { FactorError } from "./factor.errors";

export function mapFactorErrorToHttpException(error: FactorError): HttpException {
  switch (error.type) {
    case "factor_invalid":
      // One answer for a wrong code, a reused code, an unknown passkey and an
      // expired challenge: telling them apart helps only someone guessing.
      return new UnauthorizedException({
        code: "factor_invalid",
        message: "that didn't work; try again",
      });
    case "reauthentication_required":
      return new ForbiddenException({
        code: "reauthentication_required",
        message: "sign in again to change how you sign in",
      });
    case "totp_already_enabled":
      return new ConflictException({
        code: "totp_already_enabled",
        message: "an authenticator app is already set up",
      });
    case "totp_not_enabled":
      return new ConflictException({
        code: "totp_not_enabled",
        message: "no authenticator app is set up",
      });
    case "passkey_not_found":
      return new NotFoundException({ code: "passkey_not_found", message: "no such passkey" });
    case "last_sign_in_method":
      return new ConflictException({
        code: "last_sign_in_method",
        message: "this is the only way left to sign in to this account",
      });
    case "factors_unavailable":
      return new ServiceUnavailableException({
        code: "factors_unavailable",
        message: "passkeys and codes are not available right now",
      });
    case "session_invalid":
    case "throttled":
    case "persistence_failed":
      return mapAuthErrorToHttpException(error);
    default: {
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
