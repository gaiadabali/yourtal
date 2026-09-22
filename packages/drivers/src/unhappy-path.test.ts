import type { Result } from "neverthrow";
import { describe, expect, it } from "vitest";
import { BOUNDARY_NAMES, type BoundaryName } from "./boundary";
import { FAULT_KINDS, type FaultPlan } from "./faults";
import type { BoundaryFailure } from "./fault-engine";
import { createDrivers } from "./registry";
import { SIMULATED_REPUTATION_IPS } from "./boundaries/device-reputation";

/**
 * YT-0536: **at least one test per boundary asserts the unhappy path.**
 *
 * ## Why the coverage itself is asserted
 *
 * The acceptance criterion could have been satisfied by eight tests in eight
 * files and a promise to remember. That is the shape `docs/03` risk 37 keeps
 * taking — a guarantee that stays green because nothing checks whether it
 * still applies. So the table below is checked against `BOUNDARY_NAMES`: a
 * new boundary fails this suite until somebody writes its failing case, and
 * the failure names the boundary rather than appearing as a silent gap.
 *
 * ## Why a table rather than bespoke tests
 *
 * Risk 41 says a simulator is our guess about a vendor wearing a green test.
 * A shared table means every boundary faces the *same* five faults from the
 * catalogue, so "does payments handle a timeout the way messaging does?" has
 * an answer. Eight hand-written failure tests would each cover whatever
 * their author thought of.
 */

/** One call per boundary, the one whose failure costs the most. */
interface Exercise {
  readonly boundary: BoundaryName;
  readonly describe: string;
  readonly call: (fault: FaultPlan) => Promise<Result<unknown, BoundaryFailure>>;
}

const NOW = 1_800_000_000_000;

function driversWith(boundary: BoundaryName, fault: FaultPlan): ReturnType<typeof createDrivers> {
  return createDrivers({}, { [boundary]: fault });
}

const EXERCISES: readonly Exercise[] = [
  {
    boundary: "payments",
    describe: "charging a user",
    call: (fault) =>
      driversWith("payments", fault).payments.charge({
        idempotencyKey: "key-1",
        amountMinor: 4_500_000,
        currency: "IDR",
        reference: "points-top-up",
      }),
  },
  {
    boundary: "disbursement",
    describe: "paying a merchant",
    call: (fault) =>
      driversWith("disbursement", fault).disbursement.payout({
        idempotencyKey: "key-1",
        merchantId: "merchant-1",
        amountMinor: 1_200_000,
        currency: "IDR",
      }),
  },
  {
    boundary: "bot_check",
    describe: "verifying a challenge token",
    call: (fault) => driversWith("bot_check", fault).botCheck.verify("sim-bot-pass"),
  },
  {
    boundary: "otp",
    describe: "issuing a code",
    call: (fault) => driversWith("otp", fault).otp.issue("+6281234567890", NOW),
  },
  {
    boundary: "messaging",
    describe: "sending a notification",
    call: (fault) =>
      driversWith("messaging", fault).messaging.send({
        idempotencyKey: "key-1",
        to: "+6281234567890",
        template: "voucher_issued",
        variables: {},
      }),
  },
  {
    boundary: "digital_goods",
    describe: "reserving a redemption code",
    call: (fault) =>
      driversWith("digital_goods", fault).digitalGoods.reserve({
        idempotencyKey: "key-1",
        sku: "pulsa-10k",
      }),
  },
  {
    boundary: "receipt_ingest",
    describe: "extracting a receipt",
    call: (fault) =>
      driversWith("receipt_ingest", fault).receiptIngest.extract("sim-receipt-clear"),
  },
  {
    boundary: "moderation",
    describe: "classifying a submission",
    call: (fault) => driversWith("moderation", fault).moderation.classify("looks fine to me"),
  },
  {
    boundary: "device_reputation",
    describe: "looking up the reputation of a source address",
    call: (fault) =>
      driversWith("device_reputation", fault).deviceReputation.lookup(
        SIMULATED_REPUTATION_IPS.residential,
      ),
  },
];

describe("every boundary is covered", () => {
  it("has an unhappy-path exercise for each one, and no orphans", () => {
    const covered = EXERCISES.map((exercise) => exercise.boundary).sort();
    // Both directions. A missing boundary is an untested failure path; an
    // extra one is an exercise for something no longer in the registry,
    // which would keep passing while testing nothing.
    expect(covered).toStrictEqual([...BOUNDARY_NAMES].sort());
  });
});

describe.each(EXERCISES)("$boundary — $describe", (exercise) => {
  it("reports a decline as a failure, not as success", async () => {
    // The most-forgotten case: the call worked and the answer was no.
    // Nothing throws, so a caller checking only for exceptions credits
    // points for a payment that never happened.
    const result = await exercise.call({ kind: "decline" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("declined");
    expect(result._unsafeUnwrapErr().mayHaveSucceeded).toBe(false);
  });

  it("reports a timeout as possibly-succeeded", async () => {
    // The dangerous one. The operation may have completed on the far side,
    // so a caller that retries without an idempotency key double-charges.
    // Carrying the uncertainty on the failure type means it has to be read.
    const result = await exercise.call({ kind: "timeout" });
    expect(result.isErr()).toBe(true);

    const failure = result._unsafeUnwrapErr();
    expect(failure.kind).toBe("timeout");
    expect(failure.mayHaveSucceeded).toBe(true);
    expect(failure.boundary).toBe(exercise.boundary);
  });

  it("recovers on retry after a transient server error", async () => {
    // Two calls on ONE driver, so the engine's attempt counter is shared:
    // the first fails, the second succeeds. A fresh driver per call would
    // fail forever and prove nothing about retrying.
    const drivers = createDrivers(
      {},
      { [exercise.boundary]: { kind: "transient_5xx_then_success", failuresBeforeSuccess: 1 } },
    );
    // Bound to the driver captured above, so the two calls share the
    // engine's attempt counter — that is what makes this a retry rather
    // than two independent attempts.
    const call = boundCall(drivers, exercise.boundary);
    const first = await call();
    expect(first.isErr()).toBe(true);
    expect(first._unsafeUnwrapErr().kind).toBe("server_error");

    const second = await call();
    expect(second.isOk(), "a retry after a transient failure should succeed").toBe(true);
  });
});

/**
 * The same operation as the table above, bound to one driver instance.
 *
 * Each call uses a FRESH but DETERMINISTIC idempotency key. Fresh, because a
 * repeated key would be answered from the replay cache and the retry would
 * prove nothing about recovery. Deterministic, because a `Math.random()` key
 * in a test about retry behaviour is exactly the nondeterminism the fault
 * catalogue exists to keep out — a flaky test gets retried until it passes.
 */
function boundCall(
  drivers: ReturnType<typeof createDrivers>,
  boundary: BoundaryName,
): () => Promise<Result<unknown, BoundaryFailure>> {
  let attempt = 0;
  const nextKey = (): string => {
    attempt += 1;
    return `${boundary}-retry-${String(attempt)}`;
  };

  switch (boundary) {
    case "payments":
      return () =>
        drivers.payments.charge({
          idempotencyKey: nextKey(),
          amountMinor: 4_500_000,
          currency: "IDR",
          reference: "points-top-up",
        });
    case "disbursement":
      return () =>
        drivers.disbursement.payout({
          idempotencyKey: nextKey(),
          merchantId: "merchant-1",
          amountMinor: 1_200_000,
          currency: "IDR",
        });
    case "bot_check":
      return () => drivers.botCheck.verify("sim-bot-pass");
    case "device_reputation":
      // A recognised fixture address, so a failure here is the injected
      // fault and never an unknown-address fallback.
      return () => drivers.deviceReputation.lookup(SIMULATED_REPUTATION_IPS.residential);
    case "otp":
      return () => drivers.otp.issue("+6281234567890", NOW);
    case "messaging":
      return () =>
        drivers.messaging.send({
          idempotencyKey: nextKey(),
          to: "+6281234567890",
          template: "voucher_issued",
          variables: {},
        });
    case "digital_goods":
      return () =>
        drivers.digitalGoods.reserve({
          idempotencyKey: nextKey(),
          sku: "pulsa-10k",
        });
    case "receipt_ingest":
      return () => drivers.receiptIngest.extract("sim-receipt-clear");
    case "moderation":
      return () => drivers.moderation.classify("looks fine to me");
  }
}

describe("the fault catalogue is exercised, not merely declared", () => {
  it("names every kind the catalogue defines", () => {
    // The tests above cover decline, timeout and transient_5xx_then_success
    // directly; the two webhook faults are about delivery rather than the
    // call, and are covered in fault-engine.test.ts. This assertion exists
    // so that adding a sixth fault kind fails here until somebody decides
    // where it is exercised.
    expect([...FAULT_KINDS].sort()).toStrictEqual([
      "decline",
      "duplicate_webhook",
      "out_of_order_webhook",
      "timeout",
      "transient_5xx_then_success",
    ]);
  });
});
