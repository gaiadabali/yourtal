import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { Region } from "./clients";

/** What YourTal knows about a person, as the provider needs it. Read in `oidc-store.ts`. */
export interface OidcAccount {
  readonly userId: string;
  readonly displayName: string;
  readonly region: Region;
  /** YYYY-MM-DD. Only ever used to compute `age_band`; never shared. */
  readonly dateOfBirth: string;
  /** The sign-in email, as stored (already normalised). Null when the account has no password credential. */
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly suspended: boolean;
}

/** The claims every app may rely on (docs/26 §1.3), and nothing else. */
export interface OidcClaims {
  readonly email: string;
  readonly email_verified: boolean;
  readonly name: string;
  readonly region: Region;
  readonly age_band: "adult" | "teen";
}

/** Which claims each scope gives (docs/26 §1.4). `sub` is the library's, pairwise. */
export const SCOPE_CLAIMS = {
  openid: ["sub"],
  email: ["email", "email_verified"],
  profile: ["name"],
  account: ["region", "age_band"],
} as const;

export function ageBandOf(account: Pick<OidcAccount, "dateOfBirth">, now: Date): "adult" | "teen" {
  return ageBandFrom(ageYearsFrom(account.dateOfBirth, now));
}

/**
 * The claims for one person, computed at issuance: `age_band` turns `adult`
 * on the 18th birthday without anything being stored. Built field by field,
 * so nothing else on the account (date of birth, user id, trust tier) can
 * reach a token by accident.
 */
export function claimsFor(account: OidcAccount, now: Date): OidcClaims {
  return {
    email: (account.email ?? "").toLowerCase(),
    email_verified: account.emailVerified,
    name: account.displayName,
    region: account.region,
    age_band: ageBandOf(account, now),
  };
}
