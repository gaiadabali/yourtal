import type { Faker } from "@faker-js/faker";

/**
 * The Sydney counterpart to `jakarta.ts` — same pattern, same reasoning, so
 * AU mock fixtures (YT-0405) are exactly as realistic as the ID ones: real
 * Sydney suburb names, entirely invented businesses in them.
 */
export const SYDNEY_SUBURBS: readonly string[] = [
  "Bondi",
  "Surry Hills",
  "Newtown",
  "Manly",
  "Parramatta",
  "Chatswood",
  "Marrickville",
  "Redfern",
  "Glebe",
  "Balmain",
  "Randwick",
  "Cronulla",
  "Neutral Bay",
  "Leichhardt",
  "Coogee",
  "Paddington",
];

export function pickSuburb(faker: Faker): string {
  return faker.helpers.arrayElement(SYDNEY_SUBURBS);
}

const SYDNEY_STREET_NAMES: readonly string[] = [
  "George Street",
  "Oxford Street",
  "King Street",
  "Crown Street",
  "Military Road",
  "Victoria Road",
  "Church Street",
  "Marine Parade",
];

/** The AU counterpart to `jakarta.ts`'s `generateMerchantLocation` — see its doc comment. */
export function generateMerchantLocationAu(
  faker: Faker,
  merchantName: string,
  branchLabel: string,
) {
  const street = faker.helpers.arrayElement(SYDNEY_STREET_NAMES);
  const district = pickSuburb(faker);
  return {
    id: faker.string.uuid(),
    name: `${merchantName} — ${branchLabel}`,
    address: `${String(faker.number.int({ min: 1, max: 200 }))} ${street}, ${district}`,
    district,
  };
}

const BRANCH_LABELS_AU: readonly string[] = ["Main Branch", "Branch 2", "Branch 3", "Branch 4"];

export function generateMerchantLocationsAu(faker: Faker, merchantName: string, count: number) {
  return Array.from({ length: count }, (_unused, index) =>
    generateMerchantLocationAu(
      faker,
      merchantName,
      BRANCH_LABELS_AU[index] ?? `Branch ${String(index + 1)}`,
    ),
  );
}

// Combinatorial, invented merchant names in the shape of real Sydney small
// businesses (a category word + an invented brand word, occasionally plus a
// flourish). None of these names are real trademarks.
const MERCHANT_CATEGORY_WORDS_AU: readonly string[] = [
  "Corner",
  "Harbour",
  "Beachside",
  "Espresso",
  "Kebab",
  "Fish & Chips",
  "Bakery",
  "Pizza",
  "Noodle",
  "Burger",
  "Roast",
  "Deli",
];

const MERCHANT_BRAND_WORDS_AU: readonly string[] = [
  "Wharf",
  "Federation",
  "Southern Cross",
  "Botany",
  "Coastal",
  "Sunrise",
  "Union",
  "Harbourside",
  "Lantern",
  "Ember",
  "Willow",
  "Anchor",
  "Cedar",
  "Palm",
  "Tide",
];

const MERCHANT_FLOURISHES_AU: readonly string[] = [
  "Co",
  "& Sons",
  "Trading Co",
  "Bar",
  "House",
  "Kitchen",
];

/** Generates a plausible-sounding, entirely invented Sydney merchant name. */
export function generateMerchantNameAu(faker: Faker): string {
  const category = faker.helpers.arrayElement(MERCHANT_CATEGORY_WORDS_AU);
  const brand = faker.helpers.arrayElement(MERCHANT_BRAND_WORDS_AU);
  const includesFlourish = faker.datatype.boolean({ probability: 0.35 });
  if (!includesFlourish) {
    return `${brand} ${category}`;
  }
  const flourish = faker.helpers.arrayElement(MERCHANT_FLOURISHES_AU);
  return `${brand} ${category} ${flourish}`;
}

/**
 * A fixed (not randomly generated), deliberately long merchant name for the
 * "long merchant name" awkward fixture — the AU counterpart to
 * `LONG_MERCHANT_NAME` in `jakarta.ts`.
 */
export const LONG_MERCHANT_NAME_AU =
  "The Beachside Corner Bakery and Espresso Bar Manly Wharf Trading Co Pty Ltd";

const CAMPAIGN_SYNOPSIS_TEMPLATES_AU: readonly ((merchant: string) => string)[] = [
  (merchant) => `Get to know ${merchant}'s newest range and how to make the most of the promo.`,
  (merchant) => `${merchant} takes you behind the scenes of how they run their business.`,
  (merchant) => `Hear the story of how ${merchant} built loyal customers across Sydney.`,
  (merchant) => `Watch this to learn what you get as a regular at ${merchant}.`,
];

export function generateCampaignSynopsisAu(faker: Faker, merchant: string): string {
  const template = faker.helpers.arrayElement(CAMPAIGN_SYNOPSIS_TEMPLATES_AU);
  return template(merchant);
}

const CAMPAIGN_TITLE_TEMPLATES_AU: readonly ((merchant: string) => string)[] = [
  (merchant) => `The Story Behind ${merchant}`,
  (merchant) => `Get to Know ${merchant}`,
  (merchant) => `${merchant}: Special Offer`,
  (merchant) => `Behind the Scenes: ${merchant}`,
];

export function generateCampaignTitleAu(faker: Faker, merchant: string): string {
  const template = faker.helpers.arrayElement(CAMPAIGN_TITLE_TEMPLATES_AU);
  return template(merchant);
}
