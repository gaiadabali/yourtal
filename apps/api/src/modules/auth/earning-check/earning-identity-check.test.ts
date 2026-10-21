import { describe, expect, it } from "vitest";
import type { Credential } from "../persistence/credential.repository";
import type { StoredPasskey } from "../persistence/passkey.repository";
import { RepositoryEarningIdentityCheck } from "./earning-identity-check";

/** F126's facts and setting, in memory; the e2e suite reads the real ones. */
function check(options: {
  appEnv: string;
  setting: unknown;
  verifiedAt: Date | null;
  passkeys: number;
  password?: boolean;
}) {
  const reads: string[] = [];
  const password: Credential | null =
    options.password === false
      ? null
      : {
          userId: "u1",
          kind: "password",
          identifier: "viewer@example.test",
          secretHash: "x",
          updatedAt: new Date(),
          verifiedAt: options.verifiedAt,
          bootstrapped: false,
        };
  const service = new RepositoryEarningIdentityCheck({
    appEnv: options.appEnv,
    settings: {
      getSetting: <T>(region: string, key: string) => {
        reads.push(`${region}:${key}`);
        return Promise.resolve(options.setting as T);
      },
    },
    credentials: {
      findByUserAndKind: (_userId, kind) => {
        reads.push(`credential:${kind}`);
        return Promise.resolve(password);
      },
    },
    passkeys: {
      listForUser: () => {
        reads.push("passkeys");
        return Promise.resolve(
          Array.from({ length: options.passkeys }, () => ({}) as StoredPasskey),
        );
      },
    },
  });
  return { service, reads };
}

describe("RepositoryEarningIdentityCheck (F126)", () => {
  it("production requires the check even with the region setting off", async () => {
    const { service } = check({
      appEnv: "production",
      setting: { enabled: false },
      verifiedAt: null,
      passkeys: 0,
    });
    expect(await service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email", "add_passkey"],
    });
  });

  it("staging follows the region's setting, and reads no facts while it is off", async () => {
    const off = check({
      appEnv: "staging",
      setting: { enabled: false },
      verifiedAt: null,
      passkeys: 0,
    });
    expect(await off.service.verdictFor("u1", "ID")).toEqual({ mayEarn: true });
    expect(off.reads).toEqual(["ID:points_identity_check"]);

    const on = check({
      appEnv: "staging",
      setting: { enabled: true },
      verifiedAt: null,
      passkeys: 1,
    });
    expect(await on.service.verdictFor("u1", "ID")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("a verified password email and a passkey pass; no passkey or no password credential does not", async () => {
    const both = check({
      appEnv: "production",
      setting: null,
      verifiedAt: new Date(),
      passkeys: 1,
    });
    expect(await both.service.verdictFor("u1", "AU")).toEqual({ mayEarn: true });
    expect(both.reads).toContain("credential:password");

    const noPasskey = check({
      appEnv: "dev",
      setting: { enabled: true },
      verifiedAt: new Date(),
      passkeys: 0,
    });
    expect(await noPasskey.service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["add_passkey"],
    });

    const noPassword = check({
      appEnv: "production",
      setting: null,
      verifiedAt: null,
      passkeys: 1,
      password: false,
    });
    expect(await noPassword.service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });
});
