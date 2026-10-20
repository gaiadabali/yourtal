import type { InteractionSharing, SignInRefusal } from "@yourtal/contracts/oidc/interaction";
import type { OidcAccount } from "./claims";
import { ageBandOf } from "./claims";
import type { SignInClient } from "./clients";
import type { AppConsent } from "./oidc-store";

/**
 * The seam for SnapApp's teen invites (docs/26 §3.3). The invite ticket fills
 * it in; until then no teen gets in anywhere.
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
  | { readonly screen: "verify_email"; readonly account: OidcAccount }
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
  readonly now: Date;
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
 * docs/26 §1.5, in order, once the person is known and before any code is
 * issued: email verified, not on hold, region, teens, then consent.
 */
export async function decideSignIn(input: SignInInput): Promise<SignInState> {
  const { account, client } = input;
  if (account === null) return { screen: input.prompts.has("create") ? "create" : "login" };
  if (!account.emailVerified || account.email === null) return { screen: "verify_email", account };
  if (account.suspended) return { screen: "refused", account, refusal: "account_on_hold" };
  if (!client.regions.includes(account.region)) {
    return { screen: "refused", account, refusal: "region_not_supported" };
  }

  const ageBand = ageBandOf(account, input.now);
  if (ageBand === "teen") {
    if (client.teens === "refuse")
      return { screen: "refused", account, refusal: "teen_not_allowed" };
    const invite = await input.teenInvites.check({
      userId: account.userId,
      client,
      inviteCode: input.teenInviteCode,
      now: input.now,
    });
    if (!invite.allowed) return { screen: "refused", account, refusal: "teen_invite_required" };
  }

  const sharing: InteractionSharing = {
    claims: sharedClaims(input.scopes),
    ageBand,
    region: account.region,
  };
  return { screen: consentCovers(input, ageBand) ? "continue" : "consent", account, sharing };
}
