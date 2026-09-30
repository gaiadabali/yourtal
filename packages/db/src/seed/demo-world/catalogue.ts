import type { Audience } from "@yourtal/contracts/audience/audience";
import type { ListingCategory } from "@yourtal/contracts/listing";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

/**
 * 13.1: the demo world beside snap-app, in each region: six brands (café,
 * fashion, games and books for teens, kids' products for parents, fitness,
 * electronics), their campaigns across both kinds and 45 s to 15 min, and
 * their vouchers. Plain data; `world.ts` makes it real and `demo-world.test.ts`
 * holds the counts the task asks for (≥ 8 teen, ≥ 4 parents, ≥ 6 teen listings).
 */
export type Region = "AU" | "ID";

/** The lengths the world is rendered at; one shared video per length and region. */
export const DEMO_LENGTHS = [45, 90, 180, 300, 900] as const;
export type DemoLength = (typeof DEMO_LENGTHS)[number];

export interface DemoCampaignSpec {
  readonly key: string;
  readonly seconds: DemoLength;
  readonly audience: Audience;
  readonly title: string;
  readonly synopsis: string;
}

export interface DemoListingSpec {
  readonly key: string;
  readonly audience: Audience;
  readonly title: string;
  readonly description: string;
  /** Face value in minor units of the region's currency; settlement is 70 % of it. */
  readonly faceValueMinor: number;
}

export interface DemoBrandSpec {
  readonly slug: string;
  readonly region: Region;
  readonly name: string;
  readonly contentCategory: ContentCategory;
  readonly listingCategory: ListingCategory;
  readonly city: string;
  readonly campaigns: readonly DemoCampaignSpec[];
  readonly listings: readonly DemoListingSpec[];
}

type Line = readonly [key: string, seconds: DemoLength, audience: Audience, title: string];
type Offer = readonly [key: string, audience: Audience, title: string, faceValueMinor: number];

function brand(
  slug: string,
  region: Region,
  name: string,
  categories: readonly [ContentCategory, ListingCategory],
  city: string,
  lines: readonly Line[],
  offers: readonly Offer[],
): DemoBrandSpec {
  const au = region === "AU";
  return {
    slug,
    region,
    name,
    contentCategory: categories[0],
    listingCategory: categories[1],
    city,
    campaigns: lines.map(([key, seconds, audience, title]) => ({
      key,
      seconds,
      audience,
      title,
      synopsis: au
        ? `${title}, from ${name}. Watch to the end and answer a question to earn points.`
        : `${title}, dari ${name}. Tonton sampai habis dan jawab satu pertanyaan untuk mendapatkan poin.`,
    })),
    listings: offers.map(([key, audience, title, faceValueMinor]) => ({
      key,
      audience,
      title,
      description: au
        ? `${title}. Show the code at ${name} to use it.`
        : `${title}. Tunjukkan kode di ${name} untuk memakainya.`,
      faceValueMinor,
    })),
  };
}

// AUD in cents, IDR in whole Rupiah (exponent 0).
const AU_BRANDS: readonly DemoBrandSpec[] = [
  brand(
    "au-harbour-grind",
    "AU",
    "Harbour Grind Café",
    ["food-and-drink", "food_beverage"],
    "Sydney",
    [
      ["cold-brew", 45, "all_ages", "Cold brew in 45 seconds"],
      ["roastery", 90, "all_ages", "Inside the roastery"],
      ["latte-art", 180, "adult", "Latte art, step by step"],
    ],
    [
      ["coffee", "all_ages", "A free coffee", 600],
      ["brunch", "adult", "$15 off brunch for two", 1_500],
    ],
  ),
  brand(
    "au-laneway-threads",
    "AU",
    "Laneway Threads",
    ["fashion", "retail"],
    "Melbourne",
    [
      ["drop", 45, "teen", "The new drop"],
      ["styling", 90, "teen", "Three ways to wear it"],
      ["studio", 180, "all_ages", "Made in our studio"],
    ],
    [
      ["tee", "teen", "$10 off a graphic tee", 1_000],
      ["hoodie", "teen", "$20 off any hoodie", 2_000],
      ["gift", "all_ages", "$25 gift card", 2_500],
    ],
  ),
  brand(
    "au-level-up",
    "AU",
    "Level Up Games & Books",
    ["games", "digital_goods"],
    "Brisbane",
    [
      ["new-release", 45, "teen", "This week's new release"],
      ["book-club", 90, "teen", "Teen book club picks"],
      ["board-games", 180, "teen", "Board games worth a weekend"],
      ["speedrun", 300, "teen", "How a speedrun works"],
    ],
    [
      ["book", "teen", "$10 off any paperback", 1_000],
      ["game-credit", "teen", "$15 game store credit", 1_500],
      ["family-game", "all_ages", "$20 off a family board game", 2_000],
    ],
  ),
  brand(
    "au-little-sprouts",
    "AU",
    "Little Sprouts",
    ["toys", "merchandise"],
    "Perth",
    [
      ["lunchbox", 45, "parents", "The lunchbox that lasts"],
      ["first-bike", 90, "parents", "Choosing a first bike"],
      ["safe-play", 180, "parents", "Safe play at home"],
    ],
    [
      ["toy", "parents", "$15 off wooden toys", 1_500],
      ["school", "parents", "$20 off school bags", 2_000],
    ],
  ),
  brand(
    "au-pulse-fitness",
    "AU",
    "Pulse Fitness",
    ["fitness", "services"],
    "Adelaide",
    [
      ["stretch", 45, "teen", "A 45-second stretch"],
      ["class", 90, "all_ages", "Try a class with us"],
      ["strength", 300, "adult", "Strength training basics"],
    ],
    [
      ["pass", "teen", "A free youth class pass", 1_200],
      ["month", "adult", "$30 off a month's membership", 3_000],
    ],
  ),
  brand(
    "au-circuit",
    "AU",
    "Circuit Electronics",
    ["electronics", "retail"],
    "Canberra",
    [
      ["earbuds", 90, "teen", "Earbuds that fit"],
      ["setup", 180, "parents", "Setting up a family tablet"],
      ["deep-dive", 900, "all_ages", "How a phone is made"],
    ],
    [
      ["cable", "teen", "$10 off chargers and cables", 1_000],
      ["speaker", "all_ages", "$25 off a smart speaker", 2_500],
    ],
  ),
];

const ID_BRANDS: readonly DemoBrandSpec[] = [
  brand(
    "id-kopi-senja",
    "ID",
    "Kopi Senja",
    ["food-and-drink", "food_beverage"],
    "Jakarta",
    [
      ["es-kopi", 45, "all_ages", "Es kopi dalam 45 detik"],
      ["sangrai", 90, "all_ages", "Di balik penyangraian"],
      ["latte-art", 180, "adult", "Latte art langkah demi langkah"],
    ],
    [
      ["kopi", "all_ages", "Kopi gratis", 25_000],
      ["sarapan", "adult", "Potongan Rp50.000 untuk sarapan berdua", 50_000],
    ],
  ),
  brand(
    "id-gaya-kota",
    "ID",
    "Gaya Kota",
    ["fashion", "retail"],
    "Bandung",
    [
      ["koleksi", 45, "teen", "Koleksi terbaru"],
      ["padu-padan", 90, "teen", "Tiga cara memakainya"],
      ["studio", 180, "all_ages", "Dibuat di studio kami"],
    ],
    [
      ["kaos", "teen", "Potongan Rp40.000 untuk kaos", 40_000],
      ["jaket", "teen", "Potongan Rp75.000 untuk jaket", 75_000],
      ["hadiah", "all_ages", "Kartu hadiah Rp100.000", 100_000],
    ],
  ),
  brand(
    "id-dunia-main",
    "ID",
    "Dunia Main & Buku",
    ["games", "digital_goods"],
    "Surabaya",
    [
      ["rilis-baru", 45, "teen", "Rilisan minggu ini"],
      ["klub-buku", 90, "teen", "Pilihan klub buku remaja"],
      ["permainan-papan", 180, "teen", "Permainan papan untuk akhir pekan"],
      ["speedrun", 300, "teen", "Cara kerja speedrun"],
    ],
    [
      ["buku", "teen", "Potongan Rp30.000 untuk buku", 30_000],
      ["saldo-game", "teen", "Saldo toko game Rp50.000", 50_000],
      ["game-keluarga", "all_ages", "Potongan Rp75.000 untuk permainan keluarga", 75_000],
    ],
  ),
  brand(
    "id-tunas-ceria",
    "ID",
    "Tunas Ceria",
    ["toys", "merchandise"],
    "Yogyakarta",
    [
      ["kotak-bekal", 45, "parents", "Kotak bekal yang awet"],
      ["sepeda-pertama", 90, "parents", "Memilih sepeda pertama"],
      ["main-aman", 180, "parents", "Bermain aman di rumah"],
    ],
    [
      ["mainan", "parents", "Potongan Rp50.000 untuk mainan kayu", 50_000],
      ["tas-sekolah", "parents", "Potongan Rp75.000 untuk tas sekolah", 75_000],
    ],
  ),
  brand(
    "id-sehat-bugar",
    "ID",
    "Sehat Bugar",
    ["fitness", "services"],
    "Denpasar",
    [
      ["peregangan", 45, "teen", "Peregangan 45 detik"],
      ["kelas", 90, "all_ages", "Coba satu kelas"],
      ["latihan-kekuatan", 300, "adult", "Dasar latihan kekuatan"],
    ],
    [
      ["kelas-remaja", "teen", "Satu kelas remaja gratis", 40_000],
      ["bulanan", "adult", "Potongan Rp100.000 untuk keanggotaan bulanan", 100_000],
    ],
  ),
  brand(
    "id-sinar-elektronik",
    "ID",
    "Sinar Elektronik",
    ["electronics", "retail"],
    "Medan",
    [
      ["earbuds", 90, "teen", "Earbuds yang pas"],
      ["tablet-keluarga", 180, "parents", "Menyiapkan tablet keluarga"],
      ["pabrik", 900, "all_ages", "Bagaimana ponsel dibuat"],
    ],
    [
      ["kabel", "teen", "Potongan Rp30.000 untuk pengisi daya", 30_000],
      ["speaker", "all_ages", "Potongan Rp100.000 untuk speaker pintar", 100_000],
    ],
  ),
];

export const DEMO_BRANDS: readonly DemoBrandSpec[] = [...AU_BRANDS, ...ID_BRANDS];

/** On-screen facts for each shared video, in its region's language; questions ask about them. */
export const DEMO_FACTS: Readonly<Record<Region, readonly string[]>> = {
  AU: [
    "Points unlock after a short hold",
    "Rewards come from local brands",
    "Watch to the end to earn",
  ],
  ID: [
    "Poin terbuka setelah masa tunggu singkat",
    "Hadiah datang dari merek lokal",
    "Tonton sampai habis untuk mendapatkan poin",
  ],
};
