import type { FastifyRequest } from "fastify";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { presentedSessionToken } from "../bearer-token";
import type { SessionService } from "../session/session.service";
import { FRESH_SIGN_IN_MS } from "./factor-settings";
import type { FactorError } from "./factor.errors";

/**
 * The caller's own account, from the session the PDP check already let
 * through. With `fresh`, the sign-in behind that session must be recent:
 * adding a passkey or an authenticator app to a session someone left open,
 * or stole, would hand them a way back in after a password change.
 */
export async function signedInUser(
  sessions: SessionService,
  request: FastifyRequest,
  now: Date,
  options: { readonly fresh: boolean },
): Promise<Result<string, FactorError>> {
  const session = await sessions.validateWithSignIn(presentedSessionToken(request), now);
  if (!session.valid) return err({ type: "session_invalid" });
  if (options.fresh && now.getTime() - session.authTime.getTime() > FRESH_SIGN_IN_MS) {
    return err({ type: "reauthentication_required" });
  }
  return ok(session.userId);
}
