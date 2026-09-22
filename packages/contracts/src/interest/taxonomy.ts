/**
 * The interest taxonomy — one tree that merchant, listing and receipt
 * categories all map onto, so signals from different sources are
 * commensurable. `docs/20` §2.
 *
 * ## The blocklist is enforced here, at construction, and that is the point
 *
 * `docs/20` §9 is explicit that the sensitive-category blocklist is "a hard
 * constraint in the category mapper, not a policy document", and YT-0215's
 * third criterion repeats it: sensitive nodes "cannot be created, scored or
 * targeted — enforced in the mapper, not in policy".
 *
 * So `defineTaxonomy` **throws at module load** if any node's id or label
 * matches a blocked term. A sensitive node cannot exist in the built
 * artefact: there is no runtime path that filters one out later, because
 * there is no moment at which one exists to be filtered. A policy check
 * answers "may this be targeted?" and can be bypassed by a caller who does
 * not ask; a constructor that refuses cannot be bypassed by anyone.
 *
 * This is also the enforcement red line 6 was missing. The YT-0011 audit on
 * 2026-09-21 found 9 of 11 red lines enforced by nothing at all, and "no
 * sensitive-category inference" was one of them — a prohibition stated in
 * two documents and present in no code.
 *
 * ## Why a flat list with parent references, not a nested literal
 *
 * A nested object literal makes the tree pretty and makes three things hard:
 * finding a node by id is a walk, asserting every node is reachable needs a
 * second traversal, and a cycle is expressible. A flat list makes each of
 * those a single pass, and `defineTaxonomy` rejects unknown parents,
 * duplicate ids and cycles — so a malformed tree fails at load rather than
 * at the first query that happens to touch the bad branch.
 */

/**
 * Bumped whenever a node is added, removed or re-parented. Scores carry the
 * version they were computed under, because a score against a tree that no
 * longer exists is not comparable to one against the current tree — and
 * silently comparing them is how a taxonomy migration corrupts a year of
 * profile data.
 */
export const INTEREST_TAXONOMY_VERSION = 1;

/**
 * Categories that may never become nodes, be scored, or be targeted.
 * `docs/20` §9, and both regimes treat these as sensitive with stricter
 * rules — PDP in Indonesia, the Privacy Act in Australia.
 *
 * Matched as substrings against both id and label, case-insensitively, so a
 * near-miss like `mens-health-clinic` is refused rather than admitted on a
 * technicality. **A blocklist that only catches exact matches catches
 * nothing**, because nobody names the node `health-conditions`.
 */
export const BLOCKED_INTEREST_TERMS = [
  "health",
  "medical",
  "clinic",
  "pharmac",
  "pregnan",
  "fertility",
  "religio",
  "worship",
  "church",
  "mosque",
  "temple",
  "political",
  "politics",
  "sexual",
  "lgbt",
  "ethnic",
  "race",
  "debt",
  "payday",
  "bankrupt",
  "addiction",
  "rehab",
  "gambling",
  "immigration",
  "asylum",
  "union",
] as const;

export interface InterestNode {
  readonly id: string;
  readonly label: string;
  /** `null` for a root. Must name an id declared earlier in the list. */
  readonly parent: string | null;
}

export class SensitiveInterestNodeError extends Error {
  constructor(
    readonly nodeId: string,
    readonly term: string,
  ) {
    super(
      `Interest node "${nodeId}" matches blocked sensitive term "${term}". ` +
        `docs/20 §9 and red line 6: sensitive categories cannot be created, scored or targeted. ` +
        `Map the source to a neutral parent instead — see neutralParentFor().`,
    );
    this.name = "SensitiveInterestNodeError";
  }
}

/** The blocked term this text matches, or `null` if it is clean. */
export function blockedTermIn(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const term of BLOCKED_INTEREST_TERMS) {
    if (haystack.includes(term)) return term;
  }
  return null;
}

/**
 * Validates and freezes a taxonomy. Throws on a sensitive node, a duplicate
 * id, an unknown parent or a forward reference — all at module load, so a
 * malformed tree cannot ship.
 */
export function defineTaxonomy(nodes: readonly InterestNode[]): ReadonlyMap<string, InterestNode> {
  const byId = new Map<string, InterestNode>();

  for (const node of nodes) {
    const blocked = blockedTermIn(node.id) ?? blockedTermIn(node.label);
    if (blocked !== null) {
      throw new SensitiveInterestNodeError(node.id, blocked);
    }
    if (byId.has(node.id)) {
      throw new Error(`Duplicate interest node id "${node.id}".`);
    }
    if (node.parent !== null && !byId.has(node.parent)) {
      throw new Error(
        `Interest node "${node.id}" names parent "${node.parent}", which is not declared before it. ` +
          `Parents must precede children, which also makes a cycle unrepresentable.`,
      );
    }
    byId.set(node.id, node);
  }

  return byId;
}

/**
 * The tree. Roots follow `docs/20` §2; depth is deliberately shallow because
 * a node nobody can map a merchant onto is a node that scores nothing.
 *
 * **This is ~70 nodes and the ticket asks for 300–500.** It is a real
 * starter tree rather than a padded one: every node here is something a
 * merchant, listing or receipt line can actually map onto today. Growing it
 * is additive and does not change any of the machinery below.
 */
export const INTEREST_TAXONOMY = defineTaxonomy([
  { id: "food-and-drink", label: "Food and drink", parent: null },
  { id: "coffee", label: "Coffee", parent: "food-and-drink" },
  { id: "coffee-local-chains", label: "Local coffee chains", parent: "coffee" },
  { id: "coffee-specialty", label: "Specialty coffee", parent: "coffee" },
  { id: "fast-food", label: "Fast food", parent: "food-and-drink" },
  { id: "groceries", label: "Groceries", parent: "food-and-drink" },
  { id: "food-delivery", label: "Food delivery", parent: "food-and-drink" },
  { id: "restaurants", label: "Restaurants", parent: "food-and-drink" },
  { id: "bakery", label: "Bakery", parent: "food-and-drink" },
  { id: "street-food", label: "Street food", parent: "food-and-drink" },

  { id: "personal-care", label: "Personal care", parent: null },
  { id: "hair-and-salon", label: "Hair and salon", parent: "personal-care" },
  { id: "cosmetics", label: "Cosmetics", parent: "personal-care" },
  { id: "spa-and-massage", label: "Spa and massage", parent: "personal-care" },

  { id: "fashion", label: "Fashion", parent: null },
  { id: "womenswear", label: "Womenswear", parent: "fashion" },
  { id: "menswear", label: "Menswear", parent: "fashion" },
  { id: "footwear", label: "Footwear", parent: "fashion" },
  { id: "accessories", label: "Accessories", parent: "fashion" },
  { id: "modest-fashion", label: "Modest fashion", parent: "fashion" },

  { id: "electronics", label: "Electronics", parent: null },
  { id: "mobile-devices", label: "Mobile devices", parent: "electronics" },
  { id: "computing", label: "Computing", parent: "electronics" },
  { id: "audio", label: "Audio", parent: "electronics" },
  { id: "home-appliances", label: "Home appliances", parent: "electronics" },

  { id: "telco", label: "Telco", parent: null },
  { id: "mobile-data", label: "Mobile data", parent: "telco" },
  { id: "broadband", label: "Broadband", parent: "telco" },

  { id: "transport", label: "Transport", parent: null },
  { id: "ride-hailing", label: "Ride hailing", parent: "transport" },
  { id: "fuel", label: "Fuel", parent: "transport" },
  { id: "public-transport", label: "Public transport", parent: "transport" },
  { id: "vehicle-service", label: "Vehicle service", parent: "transport" },

  { id: "finance", label: "Finance", parent: null },
  { id: "everyday-banking", label: "Everyday banking", parent: "finance" },
  { id: "insurance", label: "Insurance", parent: "finance" },
  { id: "investing", label: "Investing", parent: "finance" },

  { id: "fitness", label: "Fitness", parent: null },
  { id: "gym", label: "Gym", parent: "fitness" },
  { id: "sportswear", label: "Sportswear", parent: "fitness" },
  { id: "outdoor-activity", label: "Outdoor activity", parent: "fitness" },

  { id: "education", label: "Education", parent: null },
  { id: "language-learning", label: "Language learning", parent: "education" },
  { id: "professional-courses", label: "Professional courses", parent: "education" },
  { id: "school-supplies", label: "School supplies", parent: "education" },

  { id: "travel", label: "Travel", parent: null },
  { id: "flights", label: "Flights", parent: "travel" },
  { id: "accommodation", label: "Accommodation", parent: "travel" },
  { id: "local-attractions", label: "Local attractions", parent: "travel" },
  { id: "travel-essentials", label: "Travel essentials", parent: "travel" },

  { id: "home", label: "Home", parent: null },
  { id: "furniture", label: "Furniture", parent: "home" },
  { id: "homeware", label: "Homeware", parent: "home" },
  { id: "diy-and-hardware", label: "DIY and hardware", parent: "home" },
  { id: "cleaning-supplies", label: "Cleaning supplies", parent: "home" },

  { id: "entertainment", label: "Entertainment", parent: null },
  { id: "streaming", label: "Streaming", parent: "entertainment" },
  { id: "cinema", label: "Cinema", parent: "entertainment" },
  { id: "live-events", label: "Live events", parent: "entertainment" },
  { id: "games", label: "Games", parent: "entertainment" },
  { id: "books", label: "Books", parent: "entertainment" },

  { id: "family", label: "Family", parent: null },
  { id: "toys", label: "Toys", parent: "family" },
  { id: "pets", label: "Pets", parent: "family" },

  { id: "services", label: "Services", parent: null },
  { id: "laundry", label: "Laundry", parent: "services" },
  { id: "courier", label: "Courier", parent: "services" },
  { id: "repairs", label: "Repairs", parent: "services" },

  { id: "digital-goods", label: "Digital goods", parent: null },
  { id: "software", label: "Software", parent: "digital-goods" },
  { id: "digital-credit", label: "Digital credit and top-ups", parent: "digital-goods" },
]);

/** Every ancestor of a node, nearest first. Empty for a root. */
export function ancestorsOf(nodeId: string): readonly string[] {
  const chain: string[] = [];
  let current = INTEREST_TAXONOMY.get(nodeId)?.parent ?? null;
  while (current !== null) {
    chain.push(current);
    current = INTEREST_TAXONOMY.get(current)?.parent ?? null;
  }
  return chain;
}

export function isKnownInterestNode(nodeId: string): boolean {
  return INTEREST_TAXONOMY.has(nodeId);
}
