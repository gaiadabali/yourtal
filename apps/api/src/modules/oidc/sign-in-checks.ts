import type { InteractionSharing, SignInRefusal } from "@yourtal/contracts/oidc/interaction";
import type { OidcAccount } from "./claims";
import { ageBandOf } from "./claims";
import type { SignInClient } from "./clients";
import type { AppConsent } from "./oidc-store";

/**
 * The seam for SnapApp's teen invites (docs/26 §3.3). The invite ticket fills
 * it in; until then no teen gets in anywhere. For that ticket:
 * - It is asked from GET /api/connect/{uid} (showing a screen) and from
 *   findAccount at token and userinfo time, so it must only ever read: an
 *   invite is used up when the teen taps Continue, never by a check.
 * - At token and userinfo time there is no invite code; answer from the
 *   standing, accepted invite and the guardian's consent.
 * - A teen's consent is recorded with source `guardian_invite` and
 *   `granted_via = 'guardian_invite'`, not as `oidc_consent_screen`.
 * - The code travels in the authorization URL's query, so it must be
 *   single-use and short-lived, and kept only as a hash.
 */
export interface TeenInviteChecker {
  check(input: {
    readonly userId: string;
    readonly client: SignInClient;
    /** The app's `teen_invite` authorization parameter, if it sent one. */
    readonly inviteCode: string | undefined;
    readonly now: Date;
  }): Promise<{ readonly allowed: true } | { readonly allowed: false }>;
}

export const TEEN_INVITE_CHECKER = Symbol("TEEN_INVITE_CHECKER");

export const NO_TEEN_INVITES_YET: TeenInviteChecker = {
  check: () => Promise.resolve({ allowed: false }),
};

export type SignInState =
  | { readonly screen: "login" | "create" }
  | { readonly screen: "verify_email" | "sign_in_again"; readonly account: OidcAccount }
  | { readonly screen: "refused"; readonly account: OidcAccount; readonly refusal: SignInRefusal }
  | {
      readonly screen: "consent" | "continue";
      readonly account: OidcAccount;
      readonly sharing: InteractionSharing;
    };

export interface SignInInput {
  /** Null when there is no valid YourTal session. */
  readonly account: OidcAccount | null;
  readonly client: SignInClient;
  readonly scopes: readonly string[];
  /** The request's `prompt` values. */
  readonly prompts: ReadonlySet<string>;
  readonly consent: AppConsent | null;
  /** The consent wording in force for the person's region; consent to an older one does not count. */
  readonly policyVersionId: string | undefined;
  readonly teenInviteCode: string | undefined;
  readonly teenInvites: TeenInviteChecker;
  /** The app asked for a newer sign-in than the session's (`signInTooOld`). */
  readonly signInAgain: boolean;
  readonly now: Date;
}

/**
 * Whether the app asked for a newer sign-in than the YourTal session's own
 * (OIDC `prompt=login` and `max_age`; the library turns `max_age=0` into
 * `prompt=login`). `prompt=login` is met only by a sign-in finished after this
 * sign-in to the app began; `max_age` by one at most that many seconds old,
 * counted in whole seconds as the ID token's `auth_time` is.
 */
export function signInTooOld(input: {
  readonly authTime: Date;
  /** When the provider started this interaction, epoch seconds (its `iat`). */
  readonly interactionStartedAt: number;
  readonly prompts: ReadonlySet<string>;
  readonly maxAge: number | undefined;
  readonly now: Date;
}): boolean {
  const authTime = input.authTime.getTime();
  if (input.prompts.has("login") && authTime < input.interactionStartedAt * 1000) return true;
  if (input.maxAge === undefined) return false;
  return Math.floor(input.now.getTime() / 1000) - Math.floor(authTime / 1000) > input.maxAge;
}

/** The claims the consent screen lists, from the scopes asked for. */
export function sharedClaims(scopes: readonly string[]): InteractionSharing["claims"] {
  const claims: InteractionSharing["claims"] = [];
  if (scopes.includes("profile")) claims.push("name");
  if (scopes.includes("email")) claims.push("email");
  if (scopes.includes("account")) claims.push("age_band", "region");
  return claims;
}

function consentCovers(input: SignInInput, ageBand: "adult" | "teen"): boolean {
  const { consent } = input;
  if (consent === null || consent.endedAt !== null) return false;
  if (input.prompts.has("consent")) return false;
  if (input.policyVersionId === undefined || consent.policyVersionId !== input.policyVersionId) {
    return false;
  }
  // A guardian's invite agreed for a teen; the adult agrees for themselves (docs/26 §1.4).
  if (consent.grantedVia === "guardian_invite" && ageBand === "adult") return false;
  return input.scopes.every((scope) => consent.scopes.includes(scope));
}

/**
 * docs/26 §1.5 checks 1 to 4, in order: email verified, not on hold, region,
 * teens. Null when the person may sign in to this app. Also run by findAccount
 * when a code or token is issued, so nothing that changed since the screen
 * (a suspension, a refused teen) slips through.
 */
export async function signInBlock(
  account: OidcAccount,
  client: SignInClient,
  teenInvites: TeenInviteChecker,
  teenInviteCode: string | undefined,
  now: Date,
): Promise<"verify_email" | SignInRefusal | null> {
  if (!account.emailVerified || account.email === null) return "verify_email";
  if (account.suspended) return "account_on_hold";
  if (!client.regions.includes(account.region)) return "region_not_supported";
  if (ageBandOf(account, now) === "teen") {
    if (client.teens === "refuse") return "teen_not_allowed";
    const invite = await teenInvites.check({
      userId: account.userId,
      client,
      inviteCode: teenInviteCode,
      now,
    });
    if (!invite.allowed) return "teen_invite_required";
  }
  return null;
}

/**
 * docs/26 §1.5, in order, once the person is known and before any code is
 * issued; then a fresh sign-in when the app asked for one (§1.4).
 */
export async function decideSignIn(input: SignInInput): Promise<SignInState> {
  const { account, client } = input;
  if (account === null) return { screen: input.prompts.has("create") ? "create" : "login" };
  const block = await signInBlock(
    account,
    client,
    input.teenInvites,
    input.teenInviteCode,
    input.now,
  );
  if (block === "verify_email") return { screen: "verify_email", account };
  if (block !== null) return { screen: "refused", account, refusal: block };
  if (input.signInAgain) return { screen: "sign_in_again", account };

  const ageBand = ageBandOf(account, input.now);
  const sharing: InteractionSharing = {
    claims: sharedClaims(input.scopes),
    ageBand,
    region: account.region,
  };
  return { screen: consentCovers(input, ageBand) ? "continue" : "consent", account, sharing };
}
