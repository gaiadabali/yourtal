import { ForbiddenException, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import { describeAuthzError } from "@yourtal/authz/decision";
import type { AuthzError } from "@yourtal/authz/decision";

const logger = new Logger("AuthzErrorMapper");

/**
 * The one adapter that turns an `AuthzError` into an HTTP response
 * (docs/13b section 4 — "exactly one adapter per app"). Every controller in
 * this app that calls `pdpClient.requireAction` and gets back an `Err` throws
 * whatever this returns; none of them build a response body themselves.
 *
 * `forbidden` is the only case a client should ever see detail on. The other
 * two are infrastructure failures — docs/14 section 8 (A10) requires them to
 * fail closed, not leak Cerbos internals to whoever is asking, so the cause
 * is logged server-side and never placed in the response body.
 */
export function mapAuthzErrorToHttpException(error: AuthzError): HttpException {
  switch (error.type) {
    case "forbidden":
      return new ForbiddenException({
        code: "forbidden",
        message: `not permitted to ${error.action} this ${error.kind}`,
      });
    case "pdp_unavailable":
    case "pdp_protocol_error":
      logger.error(describeAuthzError(error));
      return new ServiceUnavailableException({
        code: "authorization_unavailable",
        message: "authorization could not be evaluated",
      });
  }
}
