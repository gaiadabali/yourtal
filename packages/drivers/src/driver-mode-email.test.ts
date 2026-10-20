import { describe, expect, it } from "vitest";
import { BOUNDARIES, BOUNDARY_NAMES } from "./boundary";
import {
  StagingDriverModeError,
  assertDriversConfigured,
  assertDriversConfiguredForBoot,
  assertStagingDriversSimulated,
} from "./driver-mode";
import type { Environment } from "./driver-mode";

/** F115: email may be live on staging only behind a non-empty EMAIL_LIVE_ALLOWLIST. */

const allSimulated: Environment = Object.fromEntries(
  BOUNDARY_NAMES.map((boundary): [string, string] => [
    BOUNDARIES[boundary].modeEnvVar,
    "simulated",
  ]),
);
const emailLive: Environment = {
  ...allSimulated,
  EMAIL_DRIVER: "live",
  EMAIL_API_KEY: "k",
  EMAIL_FROM: "noreply@example.org",
};
const paymentsLive: Environment = {
  PAYMENTS_DRIVER: "live",
  PAYMENTS_API_KEY: "k",
  PAYMENTS_WEBHOOK_SECRET: "s",
};

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("staging email allow-list exception (F115)", () => {
  it("boots on staging with email live and a non-empty allow-list", () => {
    const env = { ...emailLive, EMAIL_LIVE_ALLOWLIST: "ops@example.org, @example.net" };
    const modes = assertDriversConfiguredForBoot(env, "staging");
    expect(modes.email).toBe("live");
  });

  it("refuses staging with email live and an unset or empty allow-list", () => {
    for (const env of [
      emailLive,
      { ...emailLive, EMAIL_LIVE_ALLOWLIST: "" },
      { ...emailLive, EMAIL_LIVE_ALLOWLIST: " , " },
    ]) {
      const thrown = thrownBy(() => assertDriversConfiguredForBoot(env, "staging"));
      expect(thrown).toBeInstanceOf(StagingDriverModeError);
      const failure = thrown as StagingDriverModeError;
      expect(failure.boundaries).toStrictEqual(["email"]);
      expect(failure.message).toContain("EMAIL_LIVE_ALLOWLIST");
      expect(failure.message).toContain("simulated");
    }
  });

  it("still refuses another live driver beside the email exception, naming only that driver", () => {
    const env = { ...emailLive, ...paymentsLive, EMAIL_LIVE_ALLOWLIST: "ops@example.org" };
    const thrown = thrownBy(() => assertDriversConfiguredForBoot(env, "staging"));
    expect(thrown).toBeInstanceOf(StagingDriverModeError);
    const failure = thrown as StagingDriverModeError;
    expect(failure.boundaries).toStrictEqual(["payments"]);
    expect(failure.message).toContain("PAYMENTS_DRIVER=live");
    expect(failure.message).not.toContain("EMAIL_DRIVER=live");
  });

  it("does not exempt email when no env is passed to the guard", () => {
    const modes = assertDriversConfigured(emailLive);
    expect(() => assertStagingDriversSimulated("staging", modes)).toThrow(StagingDriverModeError);
  });

  it("leaves non-staging environments unchanged", () => {
    for (const appEnv of ["dev", "production", "", "test"]) {
      expect(() => assertDriversConfiguredForBoot(emailLive, appEnv)).not.toThrow();
      expect(() =>
        assertDriversConfiguredForBoot({ ...emailLive, ...paymentsLive }, appEnv),
      ).not.toThrow();
    }
  });
});
