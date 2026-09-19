import { type Result, err, ok } from "neverthrow";
import { BOUNDARIES, BOUNDARY_NAMES, type BoundaryName } from "./boundary";

/**
 * Choosing which implementation of a boundary runs. YT-0535.
 *
 * ## `simulated` is the default, everywhere
 *
 * Including CI and a fresh clone. The alternative — requiring every
 * developer to opt into simulation — means a missing variable silently
 * reaches for a vendor, and the first person to notice is whoever gets the
 * bill or the rate limit.
 *
 * ## Choosing `live` without its credential fails at boot
 *
 * Never falls back. This is the rule the whole module exists for, and the
 * reason is asymmetric: a fallback that logs a warning behaves *correctly in
 * every test* and wrongly exactly once, in production, where a payment flow
 * would settle nothing and report success. There is no observation that
 * distinguishes "simulator, because we meant to" from "simulator, because a
 * variable was misspelled" — so the code must refuse to be in that state
 * rather than report it.
 *
 * An unknown value is an error too, for the same reason: `PAYMENTS_DRIVER=Live`
 * or `=production` must not quietly mean `simulated`.
 *
 * ## Every boundary is checked at once
 *
 * `assertDriversConfigured` reports every misconfigured boundary together
 * rather than throwing on the first. Fixing a deployment one boot failure at
 * a time, each revealing the next, is a slow way to learn you were missing
 * four variables.
 */

export const DRIVER_MODES = ["simulated", "live"] as const;
export type DriverMode = (typeof DRIVER_MODES)[number];

export const DEFAULT_DRIVER_MODE: DriverMode = "simulated";

export type DriverConfigProblem =
  | {
      readonly kind: "unknown_mode";
      readonly boundary: BoundaryName;
      readonly variable: string;
      readonly value: string;
    }
  | {
      readonly kind: "missing_credentials";
      readonly boundary: BoundaryName;
      readonly variable: string;
      readonly missing: readonly string[];
    };

export type Environment = Readonly<Record<string, string | undefined>>;

function present(env: Environment, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.trim() !== "";
}

function isDriverMode(value: string): value is DriverMode {
  return DRIVER_MODES.some((mode) => mode === value);
}

/** The mode for one boundary, or why the configuration is unusable. */
export function resolveDriverMode(
  boundary: BoundaryName,
  env: Environment,
): Result<DriverMode, DriverConfigProblem> {
  const definition = BOUNDARIES[boundary];
  const raw = env[definition.modeEnvVar];

  if (raw === undefined || raw.trim() === "") {
    return ok(DEFAULT_DRIVER_MODE);
  }

  const value = raw.trim();
  if (!isDriverMode(value)) {
    return err({
      kind: "unknown_mode",
      boundary,
      variable: definition.modeEnvVar,
      value,
    });
  }

  if (value === "simulated") {
    return ok("simulated");
  }

  const missing = definition.liveCredentialEnvVars.filter((name) => !present(env, name));
  if (missing.length > 0) {
    return err({
      kind: "missing_credentials",
      boundary,
      variable: definition.modeEnvVar,
      missing,
    });
  }

  return ok("live");
}

export function describeProblem(problem: DriverConfigProblem): string {
  const definition = BOUNDARIES[problem.boundary];
  if (problem.kind === "unknown_mode") {
    return (
      `${problem.variable}="${problem.value}" is not a driver mode. ` +
      `Use "simulated" or "live". It is NOT defaulted, because a typo that silently ` +
      `means "simulated" is indistinguishable from choosing it.`
    );
  }
  return (
    `${problem.variable}="live" was requested for the ${problem.boundary} boundary ` +
    `(${definition.purpose}) but these are unset: ${problem.missing.join(", ")}. ` +
    `Refusing to fall back to the simulator: a silent fallback in production is ` +
    `indistinguishable from working. Live vendor: ${definition.liveVendor}`
  );
}

/** Thrown at boot. Carries every problem, not just the first one found. */
export class DriverConfigurationError extends Error {
  readonly problems: readonly DriverConfigProblem[];

  constructor(problems: readonly DriverConfigProblem[]) {
    super(
      `${String(problems.length)} external boundar${problems.length === 1 ? "y is" : "ies are"} ` +
        `misconfigured:\n` +
        problems.map((problem) => `  - ${describeProblem(problem)}`).join("\n"),
    );
    this.name = "DriverConfigurationError";
    this.problems = problems;
  }
}

/**
 * The boot check. Returns the mode for every boundary, or throws with all of
 * them listed.
 *
 * Throws rather than returning a `Result` on purpose, unlike everything else
 * here: a `Result` can be ignored, and the one failure mode this module
 * exists to prevent is a misconfiguration that gets past startup. The
 * per-boundary function returns a `Result` so it stays testable.
 */
export function assertDriversConfigured(env: Environment): Record<BoundaryName, DriverMode> {
  const resolved = BOUNDARY_NAMES.map(
    (boundary) => [boundary, resolveDriverMode(boundary, env)] as const,
  );

  const problems = resolved.flatMap(([, result]) => (result.isErr() ? [result.error] : []));
  if (problems.length > 0) {
    throw new DriverConfigurationError(problems);
  }

  const modeOf = (boundary: BoundaryName): DriverMode => {
    const found = resolved.find(([name]) => name === boundary)?.[1];
    // Unreachable: every boundary resolved, or we threw above. Written as a
    // throw rather than a `?? DEFAULT` so that a future bug here surfaces
    // instead of silently choosing the simulator — which is the one wrong
    // answer this whole module exists to prevent.
    if (found === undefined || found.isErr()) {
      throw new Error(`Driver mode for ${boundary} was not resolved`);
    }
    return found.value;
  };

  // Spelled out rather than reduced into an `as`-cast accumulator: the
  // compiler then enforces that a new boundary is handled here, instead of a
  // cast promising a completeness nobody checked.
  return {
    payments: modeOf("payments"),
    disbursement: modeOf("disbursement"),
    bot_check: modeOf("bot_check"),
    otp: modeOf("otp"),
    messaging: modeOf("messaging"),
    digital_goods: modeOf("digital_goods"),
    receipt_ingest: modeOf("receipt_ingest"),
    moderation: modeOf("moderation"),
  };
}
