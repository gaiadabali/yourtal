import { describe, expect, it, vi } from "vitest";
import { DATA_DOMAINS } from "./dsar";
import type { DataDomain } from "./dsar";
import { executeDeletion, unhandledDomains } from "./dsar-orchestrator";
import type { HandlerRegistry } from "./dsar-orchestrator";

const SUBJECT = "11111111-1111-4111-8111-111111111111";

const domain = (over: Partial<DataDomain> = {}): DataDomain => ({
  id: "watch_sessions",
  holds: "stuff",
  service: "watch",
  owner: "ops",
  onDeletion: "erase",
  ...over,
});

describe("a domain with no handler", () => {
  it("fails the whole request rather than being skipped", async () => {
    // The failure this orchestrator exists to prevent: nine services must
    // act, the loop covers six, and the subject is told they were erased.
    const report = await executeDeletion(SUBJECT, {}, [domain()]);

    expect(report.complete).toBe(false);
    expect(report.results[0]?.outcome).toEqual({ status: "unhandled", owner: "ops" });
  });

  it("names the owner, so the failure says who has to write it", async () => {
    const report = await executeDeletion(SUBJECT, {}, [domain({ owner: "finance" })]);
    expect(report.results[0]?.outcome).toMatchObject({ owner: "finance" });
  });

  it("makes one gap fail a request that is otherwise complete", async () => {
    const report = await executeDeletion(SUBJECT, { identity: () => Promise.resolve(1) }, [
      domain({ id: "identity" }),
      domain({ id: "watch_sessions" }),
    ]);

    expect(report.results[0]?.outcome).toMatchObject({ status: "erased" });
    expect(report.results[1]?.outcome).toMatchObject({ status: "unhandled" });
    expect(report.complete, "one unhandled domain must fail the request").toBe(false);
  });
});

describe("a handler that throws", () => {
  it("is recorded as failed, distinctly from unhandled", async () => {
    // Different people fix these: one is a missing implementation, the other
    // a broken one. Collapsing them sends the wrong person looking.
    const handlers: HandlerRegistry = {
      watch_sessions: () => Promise.reject(new Error("watch service unreachable")),
    };

    const report = await executeDeletion(SUBJECT, handlers, [domain()]);

    expect(report.results[0]?.outcome).toEqual({
      status: "failed",
      reason: "watch service unreachable",
    });
    expect(report.complete).toBe(false);
  });

  it("does not stop the other domains from running", async () => {
    // One broken service must not leave eight others holding data they were
    // asked to erase.
    const erased = vi.fn(() => Promise.resolve(3));
    const handlers: HandlerRegistry = {
      watch_sessions: () => Promise.reject(new Error("down")),
      identity: erased,
    };

    await executeDeletion(SUBJECT, handlers, [
      domain({ id: "watch_sessions" }),
      domain({ id: "identity" }),
    ]);

    expect(erased).toHaveBeenCalledWith(SUBJECT);
  });
});

describe("retained domains", () => {
  it("need no handler and carry their basis into the report", async () => {
    // Doing nothing is the correct action here, and the audit has to be able
    // to read WHY rather than infer it from an absence.
    const report = await executeDeletion(SUBJECT, {}, [
      domain({ id: "risk_signals", onDeletion: "retain", basis: "fraud prevention" }),
    ]);

    expect(report.results[0]?.outcome).toEqual({ status: "retained", basis: "fraud prevention" });
    expect(report.complete).toBe(true);
  });

  it("are not counted as gaps", () => {
    const retained = domain({ id: "tax_records", onDeletion: "retain", basis: "statutory" });
    expect(unhandledDomains({}, [retained])).toEqual([]);
  });
});

describe("a fully handled request", () => {
  it("reports complete, with what each domain did", async () => {
    const handlers: HandlerRegistry = {
      identity: () => Promise.resolve(1),
      ledger: () => Promise.resolve(42),
    };

    const report = await executeDeletion(SUBJECT, handlers, [
      domain({ id: "identity", onDeletion: "erase" }),
      domain({ id: "ledger", onDeletion: "anonymise", basis: "hash chain" }),
    ]);

    expect(report.complete).toBe(true);
    expect(report.results).toEqual([
      { domain: "identity", outcome: { status: "erased", records: 1 } },
      { domain: "ledger", outcome: { status: "anonymised", records: 42 } },
    ]);
  });
});

describe("against the real domain map", () => {
  it("reports today's gap honestly rather than asserting it away", () => {
    // Most domains have no handler yet, and that is the true state. This
    // asserts the SHAPE — that the gap is visible and countable — not a
    // number, because pinning the number would mean editing a test every
    // time a service ships a handler, and a test people routinely edit stops
    // being read.
    const gaps = unhandledDomains({});

    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.onDeletion, "a retained domain is not a gap").not.toBe("retain");
      expect(gap.owner.length, "every gap names who owes the handler").toBeGreaterThan(0);
    }
  });

  it("would refuse a deletion today, because most domains are unhandled", async () => {
    const report = await executeDeletion(SUBJECT, {});

    expect(report.complete, "a deletion cannot be complete while handlers are missing").toBe(false);
    expect(report.results).toHaveLength(DATA_DOMAINS.length);
  });
});
