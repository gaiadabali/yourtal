import { describe, expect, it } from "vitest";

import {
  interestForListingCategory,
  interestForMerchantCategory,
  LISTING_CATEGORIES,
  LISTING_CATEGORY_TO_INTEREST,
  neutralParentFor,
} from "./category-map";
import {
  ancestorsOf,
  blockedTermIn,
  BLOCKED_INTEREST_TERMS,
  defineTaxonomy,
  INTEREST_TAXONOMY,
  INTEREST_TAXONOMY_VERSION,
  isKnownInterestNode,
  SensitiveInterestNodeError,
} from "./taxonomy";

describe("the taxonomy loads and is well formed", () => {
  it("has a version and nodes", () => {
    expect(INTEREST_TAXONOMY_VERSION).toBe(1);
    expect(INTEREST_TAXONOMY.size).toBeGreaterThan(50);
  });

  it("every non-root parent resolves, so no node is orphaned", () => {
    for (const node of INTEREST_TAXONOMY.values()) {
      if (node.parent !== null) {
        expect(INTEREST_TAXONOMY.has(node.parent)).toBe(true);
      }
    }
  });

  it("every chain terminates at a root, so there are no cycles", () => {
    for (const id of INTEREST_TAXONOMY.keys()) {
      const chain = ancestorsOf(id);
      expect(chain.length).toBeLessThan(10);
      expect(new Set(chain).size).toBe(chain.length);
    }
  });

  it("contains no node matching a blocked term — the shipped tree is clean", () => {
    for (const node of INTEREST_TAXONOMY.values()) {
      expect(blockedTermIn(node.id)).toBeNull();
      expect(blockedTermIn(node.label)).toBeNull();
    }
  });
});

describe("a sensitive node cannot be created — proved by trying", () => {
  // The guard is the enforcement red line 6 was missing, so it is asserted
  // failing rather than only passing. A guard first seen green has not been
  // shown to work.
  it("throws on a node whose id matches a blocked term", () => {
    expect(() =>
      defineTaxonomy([{ id: "health-conditions", label: "Health", parent: null }]),
    ).toThrow(SensitiveInterestNodeError);
  });

  it("throws on a node whose LABEL matches even when the id looks innocent", () => {
    expect(() =>
      defineTaxonomy([{ id: "wellbeing-42", label: "Pregnancy support", parent: null }]),
    ).toThrow(/blocked sensitive term "pregnan"/u);
  });

  it("catches near-misses, because nobody names the node after the rule", () => {
    // `mens-health-clinic` is the realistic shape: a plausible merchant
    // category that an exact-match blocklist would admit.
    expect(() =>
      defineTaxonomy([{ id: "mens-health-clinic", label: "Clinic", parent: null }]),
    ).toThrow(SensitiveInterestNodeError);
  });

  it("names the offending node and term, so the error is actionable", () => {
    try {
      defineTaxonomy([{ id: "payday-loans", label: "Payday loans", parent: null }]);
      expect.unreachable("expected a SensitiveInterestNodeError");
    } catch (error) {
      // Narrowed with `instanceof` rather than asserted: this package bans
      // type assertions outright, and a test that reaches for `as` to read
      // an error's fields is claiming a shape it has not checked.
      if (!(error instanceof SensitiveInterestNodeError)) throw error;
      expect(error.nodeId).toBe("payday-loans");
      expect(error.term).toBe("payday");
      expect(error.message).toContain("neutralParentFor");
    }
  });

  it("every blocked term is actually rejected, not just the ones with a test", () => {
    for (const term of BLOCKED_INTEREST_TERMS) {
      expect(() => defineTaxonomy([{ id: `x-${term}-y`, label: "Neutral", parent: null }])).toThrow(
        SensitiveInterestNodeError,
      );
    }
  });
});

describe("malformed trees are rejected at construction", () => {
  it("rejects a duplicate id", () => {
    expect(() =>
      defineTaxonomy([
        { id: "coffee", label: "Coffee", parent: null },
        { id: "coffee", label: "Coffee again", parent: null },
      ]),
    ).toThrow(/Duplicate/u);
  });

  it("rejects a forward reference, which is what makes a cycle unrepresentable", () => {
    expect(() =>
      defineTaxonomy([{ id: "child", label: "Child", parent: "parent-declared-later" }]),
    ).toThrow(/not declared before it/u);
  });
});

describe("listing categories map onto the tree", () => {
  it("every listing category has a mapping", () => {
    for (const category of LISTING_CATEGORIES) {
      expect(LISTING_CATEGORY_TO_INTEREST[category]).toBeDefined();
    }
  });

  it("every mapping lands on a real node", () => {
    for (const category of LISTING_CATEGORIES) {
      expect(isKnownInterestNode(interestForListingCategory(category))).toBe(true);
    }
  });
});

describe("merchants implying a sensitive category map to a neutral parent", () => {
  it("a pharmacy maps to personal-care, never to anything health-shaped", () => {
    const mapped = interestForMerchantCategory("Pharmacy");
    expect(mapped.nodeId).toBe("personal-care");
    expect(mapped.neutralisedFrom).toBe("pharmac");
  });

  it("the Indonesian term is covered too", () => {
    expect(neutralParentFor("Apotek Sehat")).toBe("personal-care");
  });

  it("a place of worship derives NOTHING, which is the correct answer", () => {
    // There is no commerce category describing a mosque without describing
    // religious observance, so the honest output is no signal at all.
    const mapped = interestForMerchantCategory("Masjid Al-Ikhlas");
    expect(mapped.nodeId).toBeNull();
    expect(mapped.neutralisedFrom).toBe("masjid");
  });

  it("the implication check runs BEFORE the direct lookup", () => {
    // "Books" is a real node. A merchant called "Medical Books" must not
    // reach it by matching the innocent half of its name.
    expect(interestForMerchantCategory("Medical Books").nodeId).toBeNull();
    expect(interestForMerchantCategory("Books").nodeId).toBe("books");
  });

  it("an unrecognised merchant maps to nothing rather than guessing", () => {
    expect(interestForMerchantCategory("Unclassifiable Widgets Ltd").nodeId).toBeNull();
  });

  it("a blocked term with no implication entry is still refused", () => {
    // `trade union` is on the blocklist but not in the implication list;
    // the second check is what catches it. The enumerated list will always
    // be incomplete, which is why there are two.
    expect(interestForMerchantCategory("union hall").nodeId).toBeNull();
  });
});
