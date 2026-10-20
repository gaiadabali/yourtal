import "server-only";

import { signInMethodsSchema } from "@yourtal/contracts/identity/sign-in-methods";
import { themeResponseSchema } from "@yourtal/contracts/me/theme-setting";
import { apiFetch } from "./api-fetch";
import { meResponseSchema } from "./me-schema";
import {
  hasSeenPasskeyPrompt,
  markPasskeyPromptSeen,
  setSessionCookies,
  setThemeCookie,
} from "./session-cookies";

/** Where a password sign-in that needs an authenticator-app code continues. */
export function codeStepPath(returnTo: string): string {
  return returnTo === "/" ? "/login/code" : `/login/code?returnTo=${encodeURIComponent(returnTo)}`;
}

export type FinishSignInResult =
  { readonly ok: true; readonly next: string } | { readonly ok: false; readonly code: string };

/**
 * The steps every way of signing in shares once the API has handed over a
 * session token: read the account's own profile, set the cookies, carry the
 * saved theme to this device, and decide where to go next. Returns the
 * destination rather than redirecting, because each caller reports a failure
 * on its own page.
 *
 * `offerPasskey` is true only after a password sign-in. The offer is made
 * once per browser (a long-lived cookie), and only to an account with no
 * passkey yet; any failure to find that out simply skips the offer.
 */
export async function finishSignIn(input: {
  token: string;
  returnTo: string;
  offerPasskey: boolean;
}): Promise<FinishSignInResult> {
  // The cookie is not set yet, so the fresh token is forwarded explicitly.
  const authorization = { authorization: `Bearer ${input.token}` };

  const me = await apiFetch("/api/me", meResponseSchema, { headers: authorization });
  if (!me.ok) return { ok: false, code: "profile_unavailable" };

  await setSessionCookies({
    token: input.token,
    region: me.data.profile.region,
    displayLocale: me.data.profile.displayLocale,
  });
  // 13.16.a: the account's saved theme follows it to a new device. A failed
  // read keeps whatever this browser already had.
  const theme = await apiFetch("/api/me/settings/theme", themeResponseSchema, {
    headers: authorization,
  });
  if (theme.ok) await setThemeCookie(theme.data.theme);

  if (input.offerPasskey && !(await hasSeenPasskeyPrompt())) {
    const methods = await apiFetch("/api/auth/sign-in-methods", signInMethodsSchema, {
      headers: authorization,
    });
    if (methods.ok && methods.data.passkeys.length === 0) {
      await markPasskeyPromptSeen();
      const query = input.returnTo === "/" ? "" : `?returnTo=${encodeURIComponent(input.returnTo)}`;
      return { ok: true, next: `/passkey${query}` };
    }
  }
  return { ok: true, next: input.returnTo };
}
