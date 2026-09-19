import type { Faker } from "@faker-js/faker";

/**
 * Real Jakarta administrative districts (kecamatan-level), used so mock data
 * reads like an actual Jakarta rollout rather than a placeholder city. These
 * are genuine district names; only the businesses "located" in them are
 * invented.
 */
export const JAKARTA_DISTRICTS: readonly string[] = [
  "Kebayoran Baru",
  "Menteng",
  "Tebet",
  "Kemang",
  "Senayan",
  "Cempaka Putih",
  "Setiabudi",
  "Kelapa Gading",
  "Cilandak",
  "Pancoran",
  "Kebon Jeruk",
  "Palmerah",
  "Tanah Abang",
  "Grogol Petamburan",
  "Pulo Gadung",
  "Matraman",
];

export function pickDistrict(faker: Faker): string {
  return faker.helpers.arrayElement(JAKARTA_DISTRICTS);
}

// Combinatorial, invented merchant names in the shape of real Jakarta small
// businesses ("Kopi Kenangan"-style: a category word + an invented brand
// word, occasionally plus a flourish). None of these names are real
// trademarks; the pools are picked so combinations read as plausible without
// reproducing any specific existing brand.
const MERCHANT_CATEGORY_WORDS: readonly string[] = [
  "Kopi",
  "Warung",
  "Kedai",
  "Toko",
  "Ayam",
  "Bakso",
  "Soto",
  "Nasi",
  "Es",
  "Sate",
  "Roti",
  "Martabak",
];

const MERCHANT_BRAND_WORDS: readonly string[] = [
  "Kenangan",
  "Nusantara",
  "Merdeka",
  "Bahagia",
  "Sentosa",
  "Berkah",
  "Harum",
  "Cempaka",
  "Melati",
  "Purnama",
  "Selera",
  "Kita",
  "Rasa",
  "Damai",
  "Sejahtera",
];

const MERCHANT_FLOURISHES: readonly string[] = ["Jaya", "Abadi", "Express", ".id", "Group", "Nusantara Jaya"];

/** Generates a plausible-sounding, entirely invented Jakarta merchant name. */
export function generateMerchantName(faker: Faker): string {
  const category = faker.helpers.arrayElement(MERCHANT_CATEGORY_WORDS);
  const brand = faker.helpers.arrayElement(MERCHANT_BRAND_WORDS);
  const includesFlourish = faker.datatype.boolean({ probability: 0.35 });
  if (!includesFlourish) {
    return `${category} ${brand}`;
  }
  const flourish = faker.helpers.arrayElement(MERCHANT_FLOURISHES);
  return `${category} ${brand} ${flourish}`;
}

/**
 * A fixed (not randomly generated), deliberately long merchant name for the
 * "long merchant name" awkward fixture — 40+ characters, so screens can be
 * checked against a 320px viewport. It still reads as a real-sounding
 * Jakarta business, just an unusually verbose one, which is realistic:
 * family businesses often stack honorifics and locations into their name.
 */
export const LONG_MERCHANT_NAME =
  "Warung Kopi Kenangan Manis Nusantara Jaya Abadi Sentosa Cabang Kebayoran Baru";

const CAMPAIGN_SYNOPSIS_TEMPLATES: readonly ((merchant: string) => string)[] = [
  (merchant) => `Kenali produk terbaru dari ${merchant} dan pelajari cara memanfaatkan promonya.`,
  (merchant) => `${merchant} mengajak Anda mengenal lebih dekat proses di balik layar bisnis mereka.`,
  (merchant) => `Simak cerita perjalanan ${merchant} membangun kepercayaan pelanggan di Jakarta.`,
  (merchant) => `Tonton video ini untuk memahami manfaat menjadi pelanggan setia ${merchant}.`,
];

export function generateCampaignSynopsis(faker: Faker, merchant: string): string {
  const template = faker.helpers.arrayElement(CAMPAIGN_SYNOPSIS_TEMPLATES);
  return template(merchant);
}

const CAMPAIGN_TITLE_TEMPLATES: readonly ((merchant: string) => string)[] = [
  (merchant) => `Cerita di Balik ${merchant}`,
  (merchant) => `Kenalan Yuk dengan ${merchant}`,
  (merchant) => `Promo Spesial ${merchant}`,
  (merchant) => `Behind the Scenes: ${merchant}`,
];

export function generateCampaignTitle(faker: Faker, merchant: string): string {
  const template = faker.helpers.arrayElement(CAMPAIGN_TITLE_TEMPLATES);
  return template(merchant);
}
