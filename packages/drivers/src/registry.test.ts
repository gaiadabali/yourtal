import { describe, expect, it } from "vitest";
import { BOUNDARIES, BOUNDARY_NAMES } from "./boundary";
import { LiveDriverNotImplementedError } from "./live-driver";
import { DRIVER_KEY_TO_BOUNDARY, createDrivers } from "./registry";
import { SIMULATED_BOT_TOKENS } from "./boundaries/bot-check";

/**
 * The registry is the thing that makes the set of boundaries closed. YT-0535.
 *
 * `docs/03` risk 41 — a simulator is our guess about a vendor wearing a green
 * test — is only manageable while "what are we guessing about?" has an exact
 * answer. A boundary that exists in code but not in the catalogue is one the
 * parity suite (YT-0539) will never run against a real vendor, so the two
 * lists agreeing is load-bearing rather than tidy.
 */

describe("the registry", () => {
  it("wires exactly the boundaries the catalogue names", () => {
    expect(Object.values(DRIVER_KEY_TO_BOUNDARY).sort()).toStrictEqual([...BOUNDARY_NAMES].sort());
  });

  it("builds every driver with an empty environment", () => {
    // A fresh clone with no .env must come up fully simulated. If this ever
    // needs configuration, the default has stopped being the simulator.
    const drivers = createDrivers({});
    for (const key of Object.keys(DRIVER_KEY_TO_BOUNDARY)) {
      const driver: unknown = Reflect.get(drivers, key);
      expect(driver, `${key} was not constructed`).toBeDefined();
    }
    expect(drivers.payments.mode).toBe("simulated");
    expect(drivers.moderation.mode).toBe("simulated");
  });

  it("refuses to construct anything when one boundary is misconfigured", async () => {
    // All-or-nothing on purpose. A half-built driver set that discovers the
    // eighth boundary is broken leaves the process running with some real
    // adapters and some absent ones.
    expect(() => createDrivers({ PAYMENTS_DRIVER: "live" })).toThrow(/PAYMENTS_API_KEY/);

    // And nothing else was reachable either — the check runs before any
    // driver is built, so a working boundary cannot be used past the error.
    const stillFine = createDrivers({});
    const verdict = await stillFine.botCheck.verify(SIMULATED_BOT_TOKENS.pass);
    expect(verdict._unsafeUnwrap().passed).toBe(true);
  });

  it("fails loudly when live has its credentials but no implementation", () => {
    // Two different problems with two different fixes: "you did not set the
    // key" and "there is no implementation yet". Conflating them sends
    // somebody hunting a key that would not have helped.
    let thrown: unknown;
    try {
      createDrivers({
        PAYMENTS_DRIVER: "live",
        PAYMENTS_API_KEY: "k",
        PAYMENTS_WEBHOOK_SECRET: "s",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LiveDriverNotImplementedError);
    const failure = thrown instanceof LiveDriverNotImplementedError ? thrown : undefined;
    expect(failure?.boundary).toBe("payments");
    // It names the ticket that will build it, so the error is a next step
    // rather than a dead end.
    expect(failure?.message).toContain(BOUNDARIES.payments.liveTicket);
    expect(failure?.message).toContain("Xendit");
  });

  it("throws at construction, not at the first call", () => {
    // A driver that returns "not implemented" per call boots, serves
    // traffic, and fails one request at a time — indistinguishable from a
    // vendor outage, and found by a user rather than by a deploy.
    expect(() =>
      createDrivers({ OTP_DRIVER: "live", OTP_API_KEY: "k", OTP_SENDER_ID: "s" }),
    ).toThrow(LiveDriverNotImplementedError);
  });
});

describe("the simulated drivers answer, rather than merely not failing", () => {
  it("reads the bot-check token instead of always passing", async () => {
    // A simulator returning `{ passed: true }` without looking at the token
    // leaves the call site untested: nothing proves the caller passes the
    // token through or handles a rejection.
    const drivers = createDrivers({});

    const pass = await drivers.botCheck.verify(SIMULATED_BOT_TOKENS.pass);
    const fail = await drivers.botCheck.verify(SIMULATED_BOT_TOKENS.fail);
    const expired = await drivers.botCheck.verify(SIMULATED_BOT_TOKENS.expired);
    const nonsense = await drivers.botCheck.verify("not-a-token");

    expect(pass._unsafeUnwrap()).toStrictEqual({ passed: true, reason: "human" });
    expect(fail._unsafeUnwrap()).toStrictEqual({ passed: false, reason: "failed_challenge" });
    expect(expired._unsafeUnwrap()).toStrictEqual({ passed: false, reason: "expired_token" });
    expect(nonsense._unsafeUnwrap()).toStrictEqual({ passed: false, reason: "malformed_token" });
  });

  it("treats a failed challenge as an answer, not an outage", async () => {
    // `ok(passed: false)`, never `err`. The two need opposite responses —
    // an outage is retried, a bot must not be.
    const drivers = createDrivers({});
    const fail = await drivers.botCheck.verify(SIMULATED_BOT_TOKENS.fail);
    expect(fail.isOk()).toBe(true);
  });
});
