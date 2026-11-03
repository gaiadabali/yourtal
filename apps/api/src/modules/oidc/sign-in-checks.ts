import type {
  InteractionSharing,
  SignInRefusal,
  TeenInviteProblem,
} from "@yourtal/contracts/oidc/interaction";
import type { OidcAccount } from "./claims";
import { ageBandOf } from "./claims";
import type { SignInClient } from "./clients";
import type { AppConsent } from "./oidc-store";

/** Whether a teen may sign in to an invite-only app now (teen-invites.ts). */
export type TeenInviteCheck =
  | {
      readonly allowed: true;
      readonly inviteId: string;
      /** The inviting guardian's YourTal name, for the teen consent screen. */
      readonly parentName: string;
      /** Not yet accepted: the teen's Continue on the consent screen uses it up. */
      readonly pending: boolean;
    }
  | { readonly allowed: false; readonly problem: TeenInviteProblem };

/**
 * SnapApp's teen invites (docs/26 §3.3). Asked from GET /api/connect/{uid}
 * and from findAccount at token and userinfo time, so it only ever reads: an
 * invite is used up when the teen taps Continue (oidc-store.ts), never by a
 * check. With no code, it answers from the standing, accepted invite.
 */
export interface TeenInviteChecker {
  check(input: {
    readonly userId: string;
    readonly client: SignInClient;
    /** The app's `teen_invite` authorization parameter, if it sent one. */
    readonly inviteCode: string | undefined;
    readonly now: Date;
  }): Promise<TeenInviteCheck>;
}

export const TEEN_INVITE_CHECKER = Symbol("TEEN_INVITE_CHECKER");

/** No invite ever lets a teen in: OIDC switched off, and tests. */
export const NO_TEEN_INVITES: TeenInviteChecker = {
  check: () => Promise.resolve({ allowed: false, problem: "no_invite" }),
};

/** The standing or pending invite a teen signs in with, as the screens need it. */
export type TeenInviteAllowed = Extract<TeenInviteCheck, { allowed: true }>;

export type SignInState =
  | { readonly screen: "login" | "create" }
  | { readonly screen: "verify_email" | "sign_in_again"; readonly account: OidcAccount }
  | {
      readonly screen: "refused";
      readonly account: OidcAccount;
      readonly refusal: SignInRefusal;
      readonly inviteProblem: TeenInviteProblem | null;
    }
  | {
      readonly screen: "consent" | "continue";
      readonly account: OidcAccount;
      readonly sharing: InteractionSharing;
      /** Set for a teen: the invite that lets them in. */
      readonly invite: TeenInviteAllowed | null;
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
  const authSeconds = Math.floor(authTime / 1000);
  // `iat` is whole seconds, so a sign-in under a second before the app asked counts as after it:
  // being stricter would loop a re-sign-in that finishes in the same second.
  if (input.prompts.has("login")) {
    if (!Number.isFinite(input.interactionStartedAt) || !Number.isFinite(authTime)) return true;
    if (authTime < input.interactionStartedAt * 1000) return true;
  }
  if (input.maxAge === undefined) return false;
  if (!Number.isFinite(input.maxAge) || !Number.isFinite(authSeconds)) return true;
  return Math.floor(input.now.getTime() / 1000) - authSeconds > input.maxAge;
}

/** The claims the consent screen lists, from the scopes asked for. */
export function sharedClaims(scopes: readonly string[]): InteractionSharing["claims"] {
  const claims: InteractionSharing["claims"] = [];
  if (scopes.includes("profile")) claims.push("name");
  if (scopes.includes("email")) claims.push("email");
  if (scopes.includes("account")) claims.push("age_band", "region");
  return claims;
}

function consentCovers(input: SignInInput, invite: TeenInviteAllowed | null): boolean {
  const { consent } = input;
  if (consent === null || consent.endedAt !== null) return false;
  if (input.prompts.has("consent")) return false;
  if (input.policyVersionId === undefined || consent.policyVersionId !== input.policyVersionId) {
    return false;
  }
  // A guardian's invite agreed for a teen; the adult agrees for themselves (docs/26 §1.4).
  if (consent.grantedVia === "guardian_invite" && invite === null) return false;
  // A teen's consent counts only under the accepted invite it was given with.
  if (invite !== null && (invite.pending || consent.inviteId !== invite.inviteId)) return false;
  return input.scopes.every((scope) => consent.scopes.includes(scope));
}

export type SignInCheck =
  | { readonly ok: true; readonly invite: TeenInviteAllowed | null }
  | {
      readonly ok: false;
      readonly block: "verify_email" | SignInRefusal;
      readonly inviteProblem: TeenInviteProblem | null;
    };

/**
 * docs/26 §1.5 checks 1 to 4, in order: email verified, not on hold, region,
 * teens. Also run by findAccount when a code or token is issued, so nothing
 * that changed since the screen (a suspension, an ended invite) slips through.
 */
export async function signInBlock(
  account: OidcAccount,
  client: SignInClient,
  teenInvites: TeenInviteChecker,
  teenInviteCode: string | undefined,
  now: Date,
): Promise<SignInCheck> {
  const refuse = (
    block: "verify_email" | SignInRefusal,
    inviteProblem: TeenInviteProblem | null = null,
  ) => ({ ok: false, block, inviteProblem }) as const;
  if (!account.emailVerified || account.email === null) return refuse("verify_email");
  if (account.suspended) return refuse("account_on_hold");
  if (!client.regions.includes(account.region)) return refuse("region_not_supported");
  if (ageBandOf(account, now) === "adult") return { ok: true, invite: null };
  if (client.teens === "refuse") return refuse("teen_not_allowed");
  const invite = await teenInvites.check({
    userId: account.userId,
    client,
    inviteCode: teenInviteCode,
    now,
  });
  if (!invite.allowed) return refuse("teen_invite_required", invite.problem);
  return { ok: true, invite };
}

/**
 * docs/26 §1.5, in order, once the person is known and before any code is
 * issued; then a fresh sign-in when the app asked for one (§1.4).
 */
export async function decideSignIn(input: SignInInput): Promise<SignInState> {
  const { account, client } = input;
  if (account === null) return { screen: input.prompts.has("create") ? "create" : "login" };
  const check = await signInBlock(
    account,
    client,
    input.teenInvites,
    input.teenInviteCode,
    input.now,
  );
  if (!check.ok) {
    const { block, inviteProblem } = check;
    if (block === "verify_email") return { screen: "verify_email", account };
    return { screen: "refused", account, refusal: block, inviteProblem };
  }
  if (input.signInAgain) return { screen: "sign_in_again", account };

  const sharing: InteractionSharing = {
    claims: sharedClaims(input.scopes),
    ageBand: ageBandOf(account, input.now),
    region: account.region,
  };
  return {
    screen: consentCovers(input, check.invite) ? "continue" : "consent",
    account,
    sharing,
    invite: check.invite,
  };
}
