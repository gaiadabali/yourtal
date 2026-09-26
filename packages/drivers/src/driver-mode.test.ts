import { describe, expect, it } from "vitest";
import { BOUNDARIES, BOUNDARY_NAMES } from "./boundary";
import {
  DriverConfigurationError,
  StagingDriverModeError,
  assertDriversConfigured,
  assertDriversConfiguredForBoot,
  assertStagingDriversSimulated,
  resolveDriverMode,
} from "./driver-mode";
import type { Environment } from "./driver-mode";

/**
 * The boot rules. YT-0535.
 *
 * These are the tests for a rule whose entire value is that it fires in
 * production and nowhere else, so they are written against the two ways it
 * could quietly not fire: a fallback, and a typo treated as a default.
 */

const noEnv = {};

describe("choosing a driver", () => {
  it("defaults every boundary to the simulator, with nothing configured", () => {
    // Including CI and a fresh clone. The alternative — opting IN to
    // simulation — means a missing variable reaches for a vendor, and the
    // first person to notice is whoever gets the bill.
    for (const boundary of BOUNDARY_NAMES) {
      const resolved = resolveDriverMode(boundary, noEnv);
      expect(resolved.isOk()).toBe(true);
      expect(resolved._unsafeUnwrap()).toBe("simulated");
    }
  });

  it("accepts an explicit simulated", () => {
    const resolved = resolveDriverMode("payments", { PAYMENTS_DRIVER: "simulated" });
    expect(resolved._unsafeUnwrap()).toBe("simulated");
  });

  it("treats blank and whitespace as unset rather than invalid", () => {
    expect(resolveDriverMode("payments", { PAYMENTS_DRIVER: "" })._unsafeUnwrap()).toBe(
      "simulated",
    );
    expect(resolveDriverMode("payments", { PAYMENTS_DRIVER: "   " })._unsafeUnwrap()).toBe(
      "simulated",
    );
  });

  const typos = ["Live", "LIVE", "production", "real", "true", "1"];
  it.each(typos)("refuses %s rather than defaulting it to simulated", (value) => {
    // The failure this catches: somebody meant `live`, wrote something else,
    // and got the simulator with no signal. Silently defaulting a typo is
    // indistinguishable from a deliberate choice.
    const resolved = resolveDriverMode("payments", { PAYMENTS_DRIVER: value });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr().kind).toBe("unknown_mode");
  });

  it("refuses live when a credential is missing, and names which", () => {
    const resolved = resolveDriverMode("payments", {
      PAYMENTS_DRIVER: "live",
      PAYMENTS_API_KEY: "present",
      // PAYMENTS_WEBHOOK_SECRET deliberately absent
    });

    expect(resolved.isErr()).toBe(true);
    const problem = resolved._unsafeUnwrapErr();
    expect(problem.kind).toBe("missing_credentials");
    expect(problem.kind === "missing_credentials" ? problem.missing : []).toStrictEqual([
      "PAYMENTS_WEBHOOK_SECRET",
    ]);
  });

  it("treats an empty credential as missing", () => {
    // `FOO=` in a .env file is the commonest way a secret goes absent, and
    // it is not the same as unset to anything that reads the environment.
    const resolved = resolveDriverMode("payments", {
      PAYMENTS_DRIVER: "live",
      PAYMENTS_API_KEY: "",
      PAYMENTS_WEBHOOK_SECRET: "  ",
    });
    expect(resolved._unsafeUnwrapErr().kind).toBe("missing_credentials");
  });

  it("allows live once every credential is present", () => {
    const resolved = resolveDriverMode("payments", {
      PAYMENTS_DRIVER: "live",
      PAYMENTS_API_KEY: "k",
      PAYMENTS_WEBHOOK_SECRET: "s",
    });
    expect(resolved._unsafeUnwrap()).toBe("live");
  });

  it("never falls back to the simulator when live is misconfigured", () => {
    // The single most important assertion here. A fallback behaves correctly
    // in every test and wrongly exactly once, in production, where a payment
    // flow would settle nothing and report success.
    for (const boundary of BOUNDARY_NAMES) {
      const resolved = resolveDriverMode(boundary, {
        [BOUNDARIES[boundary].modeEnvVar]: "live",
      });
      expect(resolved.isOk(), `${boundary} fell back instead of failing`).toBe(false);
    }
  });
});

describe("the boot check", () => {
  it("returns a mode for every boundary when nothing is set", () => {
    const modes = assertDriversConfigured(noEnv);
    expect(Object.keys(modes).sort()).toStrictEqual([...BOUNDARY_NAMES].sort());
    expect(Object.values(modes).every((mode) => mode === "simulated")).toBe(true);
  });

  it("throws, and reports every misconfigured boundary at once", () => {
    // Not one at a time. Fixing a deployment by restarting until the next
    // failure appears is a slow way to learn you were missing four
    // variables.
    let thrown: unknown;
    try {
      assertDriversConfigured({
        PAYMENTS_DRIVER: "live",
        DISBURSEMENT_DRIVER: "live",
        OTP_DRIVER: "nonsense",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DriverConfigurationError);
    const failure = thrown instanceof DriverConfigurationError ? thrown : undefined;
    expect(failure?.problems).toHaveLength(3);
    expect(failure?.message).toContain("PAYMENTS_API_KEY");
    expect(failure?.message).toContain("DISBURSEMENT_API_KEY");
    expect(failure?.message).toContain("OTP_DRIVER");
  });

  it("says what to set, not merely that something is wrong", () => {
    let message = "";
    try {
      assertDriversConfigured({ MESSAGING_DRIVER: "live" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("MESSAGING_API_KEY");
    expect(message).toContain("MESSAGING_SENDER_ID");
    // And why it refused, so nobody "fixes" it by adding a fallback.
    expect(message).toContain("indistinguishable from working");
  });
});

describe("staging posture (2.3.b)", () => {
  // Fully-configured live credentials for every boundary — the case
  // `assertDriversConfigured` alone would happily allow, in any environment.
  const allLive: Environment = Object.fromEntries(
    BOUNDARY_NAMES.flatMap((boundary): [string, string][] => {
      const definition = BOUNDARIES[boundary];
      return [
        [definition.modeEnvVar, "live"],
        ...definition.liveCredentialEnvVars.map((name): [string, string] => [name, "present"]),
      ];
    }),
  );
  const allSimulated: Environment = Object.fromEntries(
    BOUNDARY_NAMES.map((boundary): [string, string] => [
      BOUNDARIES[boundary].modeEnvVar,
      "simulated",
    ]),
  );

  it("boots on staging when every driver is simulated", () => {
    const modes = assertDriversConfiguredForBoot(allSimulated, "staging");
    expect(Object.values(modes).every((mode) => mode === "simulated")).toBe(true);
  });

  it("boots on staging with nothing configured (the default is simulated)", () => {
    expect(() => assertDriversConfiguredForBoot(noEnv, "staging")).not.toThrow();
  });

  it("refuses staging when any driver is fully-configured live, naming it", () => {
    let thrown: unknown;
    try {
      assertDriversConfiguredForBoot(allLive, "staging");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StagingDriverModeError);
    const failure = thrown as StagingDriverModeError;
    // Every boundary was live, so every boundary is named.
    for (const boundary of BOUNDARY_NAMES) {
      expect(failure.message).toContain(boundary);
    }
    expect(failure.message).toContain("simulated");
  });

  it("names only the boundaries that are actually live, not every boundary", () => {
    const oneLive = {
      ...allSimulated,
      PAYMENTS_DRIVER: "live",
      PAYMENTS_API_KEY: "k",
      PAYMENTS_WEBHOOK_SECRET: "s",
    };
    expect(() =>
      assertStagingDriversSimulated("staging", assertDriversConfigured(oneLive)),
    ).toThrow(StagingDriverModeError);
    let thrown: unknown;
    try {
      assertStagingDriversSimulated("staging", assertDriversConfigured(oneLive));
    } catch (error) {
      thrown = error;
    }
    const failure = thrown as StagingDriverModeError;
    expect(failure.boundaries).toStrictEqual(["payments"]);
    expect(failure.message).toContain("PAYMENTS_DRIVER=live");
    expect(failure.message).not.toContain("disbursement");
  });

  it("dev (and any non-staging APP_ENV) is unaffected by a live driver", () => {
    for (const appEnv of ["dev", "production", "", "test"]) {
      expect(() => assertDriversConfiguredForBoot(allLive, appEnv)).not.toThrow();
    }
  });

  it("staging's ordinary misconfiguration check still runs first", () => {
    // Live requested with no credentials: this is `missing_credentials`,
    // caught by assertDriversConfigured before the staging rule ever runs.
    expect(() => assertDriversConfiguredForBoot({ PAYMENTS_DRIVER: "live" }, "staging")).toThrow(
      DriverConfigurationError,
    );
  });
});

describe("the boundary catalogue", () => {
  it("gives every boundary a distinct mode variable and at least one credential", () => {
    const variables = BOUNDARY_NAMES.map((name) => BOUNDARIES[name].modeEnvVar);
    expect(variables).toStrictEqual([...new Set(variables)]);

    for (const name of BOUNDARY_NAMES) {
      // A boundary with no credentials could be switched to `live` with no
      // configuration at all, which would make the boot rule unenforceable
      // for it — the one hole that cannot be spotted by reading the rule.
      expect(BOUNDARIES[name].liveCredentialEnvVars.length).toBeGreaterThan(0);
      // Either the archived board's ticket id, or TASKS.md's own numbering
      // (e.g. "1.6") for anything named after the 2026-09-25 reset — see
      // CLAUDE.md: the old board is archived, TASKS.md is the plan now.
      expect(BOUNDARIES[name].liveTicket).toMatch(/^(YT-\d{4}|\d+\.\d+)$/);
    }
  });
});
