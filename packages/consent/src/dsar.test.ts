import { describe, expect, it } from "vitest";
import { DATA_DOMAINS, dataDomainSchema, deletionPlan, withdrawalEffects } from "./dsar";

describe("the deletion plan", () => {
  it("accounts for every data domain", () => {
    // Silence is not an answer. A domain missing from the plan is a domain
    // nobody deletes, and nobody notices until a regulator asks.
    expect(deletionPlan()).toHaveLength(DATA_DOMAINS.length);
    expect(DATA_DOMAINS.length).toBeGreaterThanOrEqual(8);
  });

  it("gives every domain a named owner", () => {
    // A role, not a person: people leave, and an unowned step silently does
    // not happen. docs/17 §5 is the role list.
    expect(DATA_DOMAINS.filter((domain) => domain.owner.length === 0)).toEqual([]);
  });

  it("makes every exception to erasure state its basis", () => {
    // An exception to the right to erasure that cannot say why is not an
    // exception. The schema enforces it; this proves the schema is on.
    const unjustified = DATA_DOMAINS.filter(
      (domain) => domain.onDeletion !== "erase" && domain.basis === undefined,
    );
    expect(unjustified).toEqual([]);
  });

  it("rejects a domain that keeps data without a basis", () => {
    expect(
      dataDomainSchema.safeParse({
        id: "shadow_profile",
        holds: "something",
        service: "somewhere",
        owner: "ops",
        onDeletion: "retain",
      }).success,
    ).toBe(false);
  });

  it("never erases the append-only stores", () => {
    // docs/14 §8 and docs/18: the ledger is append-only and hash-chained
    // with a published Merkle root. Deleting an entry breaks the proof for
    // every OTHER user's balance, not just this one's.
    const ledger = DATA_DOMAINS.find((domain) => domain.id === "ledger");
    expect(ledger?.onDeletion).toBe("anonymise");
    expect(ledger?.basis).toMatch(/chain/i);
  });

  it("does not let deletion erase fraud signals", () => {
    // Otherwise deletion becomes the last step of the attack: farm the
    // rewards, then request erasure of the evidence.
    const risk = DATA_DOMAINS.find((domain) => domain.id === "risk_signals");
    expect(risk?.onDeletion).toBe("retain");
  });

  it("retains the consent records themselves", () => {
    // Erasing them would destroy the proof that past processing was lawful —
    // which is what the subject's own complaint would need to examine.
    expect(DATA_DOMAINS.find((domain) => domain.id === "consent_records")?.onDeletion).toBe(
      "retain",
    );
  });

  it("has no duplicate domain ids", () => {
    const ids = DATA_DOMAINS.map((domain) => domain.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

describe("withdrawal", () => {
  it("is forward-looking and never erases", () => {
    // Withdrawal and deletion are different requests with different
    // consequences. A user switching off interest targeting has not asked
    // to lose their voucher history.
    const effects = withdrawalEffects("declared_interest_targeting");

    expect(effects.erases).toBe(false);
    expect(effects.stopsProcessingFor).toBe("declared_interest_targeting");
  });
});
