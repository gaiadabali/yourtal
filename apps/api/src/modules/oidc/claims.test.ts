import type { KoaContextWithOIDC } from "oidc-provider";
import { describe, expect, it } from "vitest";
import type { OidcAccount } from "./claims";
import { claimsFor } from "./claims";
import { CLIENTS } from "./clients";
import { findAccountFrom } from "./find-account";
import { NO_TEEN_INVITES_YET } from "./sign-in-checks";

const ACCOUNT: OidcAccount = {
  userId: "6f1c2b9e-4a7d-4c1e-9b2a-3d5e6f708192",
  displayName: "Ana",
  region: "AU",
  dateOfBirth: "2008-03-15",
  email: "Ana@Example.com",
  emailVerified: true,
  suspended: false,
};

const AFTER_18TH = new Date("2026-03-15T00:00:00Z");
const BEFORE_18TH = new Date("2026-03-14T23:59:59Z");

describe("claims (docs/26 §1.3)", () => {
  it("are exactly email, email_verified, name, region and age_band", () => {
    expect(Object.keys(claimsFor(ACCOUNT, AFTER_18TH)).sort()).toEqual(
      ["age_band", "email", "email_verified", "name", "region"].sort(),
    );
  });

  it("never carry the date of birth or the user id, in any form", () => {
    const serialised = JSON.stringify(claimsFor(ACCOUNT, AFTER_18TH));
    expect(serialised).not.toContain("2008");
    expect(serialised).not.toContain("03-15");
    expect(serialised).not.toContain(ACCOUNT.userId);
    expect(serialised).not.toMatch(/birth|dob|trust|balance|guardian/i);
  });

  it("lower-case the email", () => {
    expect(claimsFor(ACCOUNT, AFTER_18TH).email).toBe("ana@example.com");
  });

  it("compute age_band at issuance: teen the day before the 18th birthday, adult on it", () => {
    expect(claimsFor(ACCOUNT, BEFORE_18TH).age_band).toBe("teen");
    expect(claimsFor(ACCOUNT, AFTER_18TH).age_band).toBe("adult");
  });

  it("carry the region and display name as stored", () => {
    const claims = claimsFor({ ...ACCOUNT, region: "ID", displayName: "Budi" }, AFTER_18TH);
    expect(claims.region).toBe("ID");
    expect(claims.name).toBe("Budi");
  });
});

/** The provider's context as findAccount reads it: the asking client and the request's params. */
function asking(clientId: string): KoaContextWithOIDC {
  return { oidc: { client: { clientId }, params: {} } } as unknown as KoaContextWithOIDC;
}

describe("findAccount", () => {
  it("gives the provider the user id as accountId and the claims above, nothing more", async () => {
    const findAccount = findAccountFrom(
      { findAccount: () => Promise.resolve(ACCOUNT) },
      () => CLIENTS,
      NO_TEEN_INVITES_YET,
      () => AFTER_18TH,
    );
    const account = await findAccount(asking("snapapp-staging-web"), ACCOUNT.userId);
    expect(account?.accountId).toBe(ACCOUNT.userId);
    const claims = await account?.claims("id_token", "openid email profile account", {}, []);
    expect(claims).toEqual({
      sub: ACCOUNT.userId,
      email: "ana@example.com",
      email_verified: true,
      name: "Ana",
      region: "AU",
      age_band: "adult",
    });
    expect(JSON.stringify(claims)).not.toContain(ACCOUNT.dateOfBirth);
  });

  it("finds nothing for an account that no longer exists", async () => {
    const findAccount = findAccountFrom(
      { findAccount: () => Promise.resolve(null) },
      () => CLIENTS,
      NO_TEEN_INVITES_YET,
    );
    expect(await findAccount(asking("snapapp-staging-web"), "gone")).toBeUndefined();
  });

  it.each([
    ["an unverified email", { emailVerified: false }, "snapapp-staging-web"],
    ["a suspended account", { suspended: true }, "snapapp-staging-web"],
    ["an Indonesian account at FTR", { region: "ID" as const }, "ftr-web"],
    ["a teen at FTR", { dateOfBirth: "2012-01-01" }, "ftr-web"],
    ["a teen at SnapApp with no invite", { dateOfBirth: "2012-01-01" }, "snapapp-staging-web"],
  ])(
    "issues nothing for %s (docs/26 §1.5, checked again at issuance)",
    async (_who, change, clientId) => {
      const findAccount = findAccountFrom(
        {
          findAccount: () => Promise.resolve({ ...ACCOUNT, dateOfBirth: "1990-01-01", ...change }),
        },
        () => CLIENTS,
        NO_TEEN_INVITES_YET,
        () => AFTER_18TH,
      );
      expect(await findAccount(asking(clientId), ACCOUNT.userId)).toBeUndefined();
    },
  );

  it("issues nothing to a client the registry does not know, or to SnapApp's server", async () => {
    const findAccount = findAccountFrom(
      { findAccount: () => Promise.resolve(ACCOUNT) },
      () => CLIENTS,
      NO_TEEN_INVITES_YET,
      () => AFTER_18TH,
    );
    expect(await findAccount(asking("unknown"), ACCOUNT.userId)).toBeUndefined();
    expect(await findAccount(asking("snapapp-staging-server"), ACCOUNT.userId)).toBeUndefined();
  });
});
