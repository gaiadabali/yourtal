import { describe, expect, it } from "vitest";
import { ledgerErrorCodeSchema } from "@yourtal/contracts/ledger-internal/ledger-error";
import { describeLedgerRefusal } from "./ledger-refusal";

/** 13.3.j. Every ledger code, and one the app has never heard of, gets a worded reason. */
describe("describeLedgerRefusal", () => {
  it.each(ledgerErrorCodeSchema.options)("words %s without leaking the code", (code) => {
    const reason = describeLedgerRefusal({ code });
    expect(reason.length).toBeGreaterThan(10);
    expect(reason).not.toContain(code);
    expect(reason.toLowerCase()).not.toMatch(/money|cash|paid|income/);
  });

  it("words an unknown code generically instead of throwing", () => {
    const reason = describeLedgerRefusal({ code: "from_a_newer_ledger" as never });
    expect(reason).toBe("Your points could not be confirmed right now.");
  });

  it("does not read inherited object keys as codes", () => {
    expect(describeLedgerRefusal({ code: "constructor" as never })).toBe(
      "Your points could not be confirmed right now.",
    );
  });

  it("keeps the wording the earning screen already showed", () => {
    expect(describeLedgerRefusal({ code: "velocity_capped" })).toBe(
      "You have reached today's earning limit.",
    );
    expect(describeLedgerRefusal({ code: "kill_switch" })).toBe("Rewards are paused right now.");
  });
});
