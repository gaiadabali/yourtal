import { describe, expect, it } from "vitest";
import { FAULT_CATALOGUE, FAULT_KINDS } from "./faults";
import { FaultEngine } from "./fault-engine";
import { createDrivers } from "./registry";

/**
 * The fault engine, and the two faults that are about delivery rather than
 * about the call. YT-0536.
 */

describe("the catalogue", () => {
  it("documents every kind, with the caller bug it catches", () => {
    expect(Object.keys(FAULT_CATALOGUE).sort()).toStrictEqual([...FAULT_KINDS].sort());
    for (const kind of FAULT_KINDS) {
      // `catches` is the field that stops this becoming a list of error
      // codes. A fault nobody can say the purpose of is one that gets
      // deleted the first time it is inconvenient.
      expect(FAULT_CATALOGUE[kind].catches.length).toBeGreaterThan(20);
      expect(FAULT_CATALOGUE[kind].behaviour.length).toBeGreaterThan(20);
    }
  });
});

describe("FaultEngine", () => {
  it("proceeds when there is no plan", () => {
    const engine = new FaultEngine();
    expect(engine.nextCall()).toBe("proceed");
    expect(engine.nextCall()).toBe("proceed");
  });

  it("is deterministic — the same plan gives the same sequence", () => {
    // No randomness anywhere. A simulator that fails at random makes a
    // flaky test, a flaky test gets retried until it passes, and a real
    // failure hides inside the retry.
    const sequence = (): string[] => {
      const engine = new FaultEngine({
        kind: "transient_5xx_then_success",
        failuresBeforeSuccess: 2,
      });
      return [engine.nextCall(), engine.nextCall(), engine.nextCall(), engine.nextCall()];
    };
    expect(sequence()).toStrictEqual(sequence());
    expect(sequence()).toStrictEqual(["server_error", "server_error", "proceed", "proceed"]);
  });

  it("lets the call succeed for webhook faults", () => {
    // The request path is fine; the damage is in delivery. A caller that
    // only tests the request never sees either of these.
    for (const kind of ["duplicate_webhook", "out_of_order_webhook"] as const) {
      expect(new FaultEngine({ kind }).nextCall()).toBe("proceed");
    }
  });

  it("delivers each event twice under duplicate_webhook", () => {
    const engine = new FaultEngine({ kind: "duplicate_webhook" });
    expect(engine.shapeDeliveries(["a", "b"])).toStrictEqual(["a", "a", "b", "b"]);
  });

  it("delivers events newest-first under out_of_order_webhook", () => {
    const engine = new FaultEngine({ kind: "out_of_order_webhook" });
    expect(engine.shapeDeliveries(["a", "b"])).toStrictEqual(["b", "a"]);
  });

  it("leaves deliveries alone otherwise", () => {
    expect(new FaultEngine().shapeDeliveries(["a", "b"])).toStrictEqual(["a", "b"]);
    expect(new FaultEngine({ kind: "decline" }).shapeDeliveries(["a"])).toStrictEqual(["a"]);
  });
});

describe("webhook faults through a real boundary", () => {
  it("delivers a payment's events twice, with the same ids", async () => {
    // AUD: the registry's default driver never declares an IDR unit (that is
    // the point — see payments.ts), so a currency-agnostic fault-injection
    // test uses the one currency the simulator can always charge.
    const drivers = createDrivers({}, { payments: { kind: "duplicate_webhook" } });
    const charge = await drivers.payments.charge({
      idempotencyKey: "dup-1",
      amountMinor: 4_500,
      currency: "AUD",
      reference: "top-up",
    });
    expect(charge.isOk()).toBe(true);

    const events = drivers.payments.deliveries(charge._unsafeUnwrap().providerReference);
    expect(events).toHaveLength(4);
    // Same id twice is the point: a handler that deduplicates on the event
    // id survives, and one that counts deliveries credits twice.
    expect(events[0]?.id).toBe(events[1]?.id);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it("delivers settled before pending, out of order", async () => {
    const drivers = createDrivers({}, { payments: { kind: "out_of_order_webhook" } });
    const charge = await drivers.payments.charge({
      idempotencyKey: "ooo-1",
      amountMinor: 4_500,
      currency: "AUD",
      reference: "top-up",
    });

    const events = drivers.payments.deliveries(charge._unsafeUnwrap().providerReference);
    // A handler applying these in arrival order writes `pending` last and
    // leaves a settled payment pending forever.
    expect(events.map((event) => event.status)).toStrictEqual(["settled", "pending"]);
    expect(events[0]?.sequence).toBeGreaterThan(events[1]?.sequence ?? 0);
  });
});

describe("idempotency under the timeout fault", () => {
  it("returns the original charge when the same key is replayed", async () => {
    // The pairing that matters: `timeout` says the far side may have
    // succeeded, and the only safe retry is one carrying the same key. A
    // simulator that ignored the key could not catch a caller that omits it.
    const drivers = createDrivers({});
    const first = await drivers.payments.charge({
      idempotencyKey: "same-key",
      amountMinor: 4_500,
      currency: "AUD",
      reference: "top-up",
    });
    const replay = await drivers.payments.charge({
      idempotencyKey: "same-key",
      amountMinor: 4_500,
      currency: "AUD",
      reference: "top-up",
    });

    expect(replay._unsafeUnwrap().providerReference).toBe(first._unsafeUnwrap().providerReference);
  });
});
