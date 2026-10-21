import { describe, expect, it } from "vitest";
import type { Credential } from "../persistence/credential.repository";
import { RepositoryEarningIdentityCheck } from "./earning-identity-check";

/** F126's facts and setting, in memory; the e2e suite reads the real ones. */
function check(options: {
  appEnv: string;
  setting: unknown;
  verifiedAt: Date | null;
  email?: string;
  password?: boolean;
}) {
  const reads: string[] = [];
  const password: Credential | null =
    options.password === false
      ? null
      : {
          userId: "u1",
          kind: "password",
          identifier: options.email ?? "viewer@example.test",
          secretHash: "x",
          updatedAt: new Date(),
          verifiedAt: options.verifiedAt,
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
  });
  return { service, reads };
}

describe("RepositoryEarningIdentityCheck (F126)", () => {
  it("production requires the check even with the region setting off", async () => {
    const { service } = check({
      appEnv: "production",
      setting: { enabled: false },
      verifiedAt: null,
    });
    expect(await service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("staging follows the region's setting, and reads no facts while it is off", async () => {
    const off = check({ appEnv: "staging", setting: { enabled: false }, verifiedAt: null });
    expect(await off.service.verdictFor("u1", "ID")).toEqual({ mayEarn: true });
    expect(off.reads).toEqual(["ID:points_identity_check"]);

    const on = check({ appEnv: "staging", setting: { enabled: true }, verifiedAt: null });
    expect(await on.service.verdictFor("u1", "ID")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("a malformed or missing setting is off outside production", async () => {
    for (const setting of [null, undefined, true, { enabled: "yes" }, { enabled: true, x: 1 }]) {
      const { service, reads } = check({ appEnv: "staging", setting, verifiedAt: null });
      expect(await service.verdictFor("u1", "AU")).toEqual({ mayEarn: true });
      expect(reads).toEqual(["AU:points_identity_check"]);
    }
  });

  it("a verified password email passes, and so do the demo domains", async () => {
    const both = check({ appEnv: "production", setting: null, verifiedAt: new Date() });
    expect(await both.service.verdictFor("u1", "AU")).toEqual({ mayEarn: true });
    expect(both.reads).toContain("credential:password");

    for (const email of ["viewer@demo.yourtal.test", "viewer@example.test"]) {
      const demo = check({
        appEnv: "dev",
        setting: { enabled: true },
        verifiedAt: new Date(),
        email,
      });
      expect(await demo.service.verdictFor("u1", "AU")).toEqual({ mayEarn: true });
    }
  });

  it("an unverified email, or no password credential at all, does not pass", async () => {
    const unverified = check({ appEnv: "dev", setting: { enabled: true }, verifiedAt: null });
    expect(await unverified.service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });

    const noPassword = check({
      appEnv: "production",
      setting: null,
      verifiedAt: null,
      password: false,
    });
    expect(await noPassword.service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email"],
    });
  });

  it("a disposable domain, or a subdomain of one, is refused even when verified", async () => {
    for (const email of ["x@mailinator.com", "x@Sub.Mailinator.COM"]) {
      const { service } = check({
        appEnv: "production",
        setting: null,
        verifiedAt: new Date(),
        email,
      });
      expect(await service.verdictFor("u1", "AU")).toEqual({
        mayEarn: false,
        missing: ["use_permanent_email"],
      });
    }
  });

  it("names both refusals at once, verification first", async () => {
    const { service } = check({
      appEnv: "production",
      setting: null,
      verifiedAt: null,
      email: "x@yopmail.com",
    });
    expect(await service.verdictFor("u1", "AU")).toEqual({
      mayEarn: false,
      missing: ["verify_email", "use_permanent_email"],
    });
  });
});
