import { NotFoundException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { GetMeError, UpdateMeError } from "./me.errors";

/** The one adapter for this module's domain errors (docs/13b section 4). */
export function mapMeErrorToHttpException(error: GetMeError | UpdateMeError): HttpException {
  switch (error.type) {
    case "profile_not_found":
      // Should not be reachable in practice: a session only ever exists for
      // a user_id `AuthService.register` already gave a profile row. Kept
      // as a real 404 rather than a 500 in case that invariant is ever
      // broken by a future migration or a manually-created session.
      return new NotFoundException({
        code: "profile_not_found",
        message: "no profile exists for this account",
      });
    default: {
      // docs/13b section 4: a `never` default so a new error variant fails
      // this file to compile rather than falling through silently.
      const unreachable: never = error;
      return new NotFoundException({ code: "unknown_error", message: String(unreachable) });
    }
  }
}
