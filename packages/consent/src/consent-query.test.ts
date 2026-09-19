import { describe, expect, it } from "vitest";
import { mayUseSignalFor } from "./consent-query";
import type { ConsentRecord } from "./consent-record";
import { ALL_PURPOSES, definitionFor } from "./purpose-catalogue";
import { currentPolicyVersion } from "./policy-version";
import { requiresConsent } from "./purpose";

const USER = "11111111-1111-4111-8111-111111111111";
const ID_VERSION = currentPolicyVersion("ID")?.id ?? "missing";
const AU_VERSION = currentPolicyVersion("AU")?.id ?? "missing";

function granted(purpose: string, over: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    userId: USER,
    // Callers only ever pass real purposes; the schema is exercised in
    // consent-record.test.ts.
    purpose: purpose as ConsentRecord["purpose"],
    jurisdiction: "ID",
    policyVersionId: ID_VERSION,
    state: "granted",
    recordedAt: "2026-09-10T00:00:00Z",
    source: "settings_toggle",
    ...over,
  };
}

describe("the ordinary path", () => {
  it("allows a consented purpose at the current policy version", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "ID",
      records: [granted("declared_interest_targeting")],
      currentPhase: "P1",
    });

    expect(decision).toEqual({
      allowed: true,
      basis: { type: "consent", policyVersionId: ID_VERSION },
    });
  });

  it("denies when there is no record at all", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "ID",
      records: [],
      currentPhase: "P1",
    });

    expect(decision).toEqual({ allowed: false, reason: { type: "consent_not_given" } });
  });

  it("denies after withdrawal, and says when", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "ID",
      records: [
        granted("declared_interest_targeting"),
        granted("declared_interest_targeting", {
          state: "withdrawn",
          recordedAt: "2026-09-11T00:00:00Z",
        }),
      ],
      currentPhase: "P1",
    });

    expect(decision).toEqual({
      allowed: false,
      reason: { type: "consent_withdrawn", withdrawnAt: "2026-09-11T00:00:00Z" },
    });
  });

  it("re-granting after a withdrawal allows again", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "ID",
      records: [
        granted("declared_interest_targeting"),
        granted("declared_interest_targeting", {
          state: "withdrawn",
          recordedAt: "2026-09-11T00:00:00Z",
        }),
        granted("declared_interest_targeting", { recordedAt: "2026-09-12T00:00:00Z" }),
      ],
      currentPhase: "P1",
    });

    expect(decision.allowed).toBe(true);
  });

  it("denies consent given against superseded wording", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "ID",
      records: [granted("declared_interest_targeting", { policyVersionId: "id-2025-01-01" })],
      currentPhase: "P1",
    });

    expect(decision).toEqual({
      allowed: false,
      reason: {
        type: "consent_stale",
        consentedVersionId: "id-2025-01-01",
        currentVersionId: ID_VERSION,
      },
    });
  });

  it("does not let consent in one jurisdiction authorise another", () => {
    // Country-isolated data planes (docs/03 §1 risk 5). A record scoped to
    // ID is not an answer about AU, and must not be found by the lookup.
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "AU",
      records: [granted("declared_interest_targeting", { jurisdiction: "ID" })],
      currentPhase: "P1",
    });

    expect(decision).toEqual({ allowed: false, reason: { type: "consent_not_given" } });
  });
});

describe("consent is necessary but not sufficient", () => {
  // docs/19: "with consent we can do anything" is FALSE. Australia's reform
  // applies a fair-and-reasonable test REGARDLESS of consent, so a granted
  // record must not be able to reach an allow. This is the suite that would
  // catch someone "optimising" the query by checking the record first.
  it("refuses behavioural profiling in AU even when consent is granted", () => {
    const decision = mayUseSignalFor({
      purpose: "behavioural_profiling",
      jurisdiction: "AU",
      records: [
        granted("behavioural_profiling", { jurisdiction: "AU", policyVersionId: AU_VERSION }),
      ],
      currentPhase: "P3",
    });

    expect(decision).toEqual({
      allowed: false,
      reason: { type: "prohibited_in_jurisdiction", jurisdiction: "AU" },
    });
  });

  it("refuses purchase-history targeting in AU even when consent is granted", () => {
    const decision = mayUseSignalFor({
      purpose: "purchase_history_targeting",
      jurisdiction: "AU",
      records: [
        granted("purchase_history_targeting", { jurisdiction: "AU", policyVersionId: AU_VERSION }),
      ],
      currentPhase: "P3",
    });

    expect(decision.allowed).toBe(false);
  });

  it("reports prohibition distinctly from a missing toggle", () => {
    // The product needs to tell these apart: one means show the toggle, the
    // other means never offer it. Collapsing them puts a prompt in front of
    // a user whose answer could only ever be no.
    const prohibited = mayUseSignalFor({
      purpose: "behavioural_profiling",
      jurisdiction: "AU",
      records: [],
      currentPhase: "P3",
    });
    const notGiven = mayUseSignalFor({
      purpose: "behavioural_profiling",
      jurisdiction: "ID",
      records: [],
      currentPhase: "P3",
    });

    expect(prohibited).toMatchObject({ reason: { type: "prohibited_in_jurisdiction" } });
    expect(notGiven).toMatchObject({ reason: { type: "consent_not_given" } });
  });
});

describe("the phase gate", () => {
  // docs/16 D3: purchase history arrives in Phase 2, with separate consent.
  // Collecting consent early does not advance the phase.
  it("refuses a P2 purpose in P1 despite consent", () => {
    const decision = mayUseSignalFor({
      purpose: "purchase_history_targeting",
      jurisdiction: "ID",
      records: [granted("purchase_history_targeting")],
      currentPhase: "P1",
    });

    expect(decision).toEqual({
      allowed: false,
      reason: { type: "not_available_yet", availableFromPhase: "P2", currentPhase: "P1" },
    });
  });

  it("allows the same purpose once the phase is reached", () => {
    const decision = mayUseSignalFor({
      purpose: "purchase_history_targeting",
      jurisdiction: "ID",
      records: [granted("purchase_history_targeting")],
      currentPhase: "P2",
    });

    expect(decision.allowed).toBe(true);
  });
});

describe("bases that are not consent", () => {
  it.each([
    ["deliver_reward", "contract"],
    ["prevent_fraud", "legal_obligation"],
    ["contextual_advertising", "no_personal_data"],
  ])("%s proceeds with no record, on basis %s", (purpose, basis) => {
    // Asking permission for something we will do anyway trains people to
    // click through, and devalues the consent we actually need.
    const decision = mayUseSignalFor({
      purpose,
      jurisdiction: "ID",
      records: [],
      currentPhase: "P1",
    });

    expect(decision).toEqual({ allowed: true, basis: { type: basis } });
  });
});

describe("failing closed", () => {
  it("denies an unknown purpose", () => {
    const decision = mayUseSignalFor({
      purpose: "to_improve_our_services",
      jurisdiction: "ID",
      records: [],
      currentPhase: "P3",
    });

    // docs/19 names this exact string as the classic insufficient purpose
    // formulation under PDP. It is not on the list, so it cannot be asked.
    expect(decision).toEqual({
      allowed: false,
      reason: { type: "unknown_purpose", purpose: "to_improve_our_services" },
    });
  });

  it("denies an unknown jurisdiction even with a matching record", () => {
    const decision = mayUseSignalFor({
      purpose: "declared_interest_targeting",
      jurisdiction: "SG",
      records: [granted("declared_interest_targeting")],
      currentPhase: "P3",
    });

    expect(decision).toEqual({
      allowed: false,
      reason: { type: "unknown_jurisdiction", jurisdiction: "SG" },
    });
  });

  it("never allows anything for an empty record set unless the basis is not consent", () => {
    // The sweep that matters: for every purpose in the catalogue, with no
    // records at all, the only allows are non-consent bases.
    for (const purpose of ALL_PURPOSES) {
      const definition = definitionFor(purpose);
      const decision = mayUseSignalFor({
        purpose,
        jurisdiction: "ID",
        records: [],
        currentPhase: "P3",
      });

      if (decision.allowed) {
        expect(definition).toBeDefined();
        expect(requiresConsent(definition?.lawfulBasis ?? "consent")).toBe(false);
      }
    }
  });
});
