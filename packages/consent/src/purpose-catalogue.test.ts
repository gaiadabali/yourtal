import { describe, expect, it } from "vitest";
import { ALL_PURPOSES, definitionFor, isProhibitedIn } from "./purpose-catalogue";
import { requiresConsent } from "./purpose";

describe("the catalogue", () => {
  it("defines every purpose in the enum", () => {
    // A purpose with no definition would fall through to unknown_purpose and
    // be permanently denied — a feature that silently never works.
    const undefined_ = ALL_PURPOSES.filter((purpose) => definitionFor(purpose) === undefined);
    expect(undefined_).toEqual([]);
  });

  it("returns undefined for anything not in the enum", () => {
    expect(definitionFor("to_improve_our_services")).toBeUndefined();
    expect(definitionFor("")).toBeUndefined();
  });

  it("gives every purpose a description that states a consequence", () => {
    // docs/12: naming the mechanism ("see and download your contacts") is
    // the pattern to avoid; the screen has to say what happens.
    for (const purpose of ALL_PURPOSES) {
      expect(definitionFor(purpose)?.description.length ?? 0).toBeGreaterThan(20);
    }
  });
});

describe("lawful basis", () => {
  it("requires consent for every purpose that profiles or shares a person", () => {
    const mustBeConsented = [
      "declared_interest_targeting",
      "behavioural_profiling",
      "purchase_history_targeting",
      "market_research_panel",
      "marketing_communications",
      "sister_app_profile_sharing",
    ];

    for (const purpose of mustBeConsented) {
      const definition = definitionFor(purpose);
      expect(definition, purpose).toBeDefined();
      expect(requiresConsent(definition?.lawfulBasis ?? "contract"), purpose).toBe(true);
    }
  });

  it("does not ask consent for delivering what was earned", () => {
    // Asking permission for something we will do anyway trains people to
    // click through, and devalues the consent that actually matters.
    expect(definitionFor("deliver_reward")?.lawfulBasis).toBe("contract");
  });

  it("keeps campaign questions and research answers as separate purposes", () => {
    // docs/01: "never let the second hide inside the first". Research
    // answers sold to a panel buyer need their own disclosure and consent;
    // reward-gating questions are part of the deal the user already took.
    expect(definitionFor("market_research_panel")?.lawfulBasis).toBe("consent");
    expect(definitionFor("deliver_reward")?.lawfulBasis).not.toBe("consent");
  });
});

describe("sensitivity and prohibition", () => {
  it("marks receipt-derived targeting sensitive", () => {
    // docs/19: a pharmacy receipt implies health; a purchase pattern implies
    // pregnancy, religious observance or financial distress.
    expect(definitionFor("purchase_history_targeting")?.sensitive).toBe(true);
  });

  it("prohibits individual behavioural advertising in AU regardless of consent", () => {
    // docs/03 §3.2 reaches "all advertising directed at individuals using
    // their personal information", and says build for the future rule.
    const behavioural = definitionFor("behavioural_profiling");
    expect(behavioural).toBeDefined();
    expect(behavioural && isProhibitedIn(behavioural, "AU")).toBe(true);
    expect(behavioural && isProhibitedIn(behavioural, "ID")).toBe(false);
  });

  it("holds receipt targeting to Phase 2", () => {
    // docs/16 D3: geo, age band and declared interest in P1; purchase
    // history from P2 with explicit separate consent.
    expect(definitionFor("purchase_history_targeting")?.availableFromPhase).toBe("P2");
    expect(definitionFor("declared_interest_targeting")?.availableFromPhase).toBe("P1");
  });

  it("never prohibits a purpose we rely on to run the platform", () => {
    // If contract- or law-based processing were prohibited somewhere, the
    // product could not operate there at all — that is a market decision,
    // not something to discover through a denied decision at runtime.
    for (const purpose of ["deliver_reward", "prevent_fraud", "comply_with_law"]) {
      expect(definitionFor(purpose)?.prohibitedIn, purpose).toEqual([]);
    }
  });
});
