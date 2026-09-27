import type { Business, BusinessRole } from "./business";
import { AU_STATES, businessSchema } from "./business";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME, generateMerchantName } from "../internal/jakarta";
import type { Region } from "../region/region";

export interface GenerateBusinessParams {
  seed: number;
  /** Defaults to "ID" — this roster started Jakarta-only; 7.1 adds the AU side alongside it. */
  region?: Region;
}

const ALL_ROLES: readonly BusinessRole[] = ["advertiser", "supplier", "redeemer"];

/** A url-safe slug from a display name — lowercase, digits and single hyphens only, within `businessHandleSchema`'s length ceiling. */
function handleFrom(displayName: string, disambiguator: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${slug}-${disambiguator}`;
}

const AU_CITIES_BY_STATE: Record<(typeof AU_STATES)[number], { city: string; postcodePrefix: string }> = {
  NSW: { city: "Sydney", postcodePrefix: "2" },
  VIC: { city: "Melbourne", postcodePrefix: "3" },
  QLD: { city: "Brisbane", postcodePrefix: "4" },
  WA: { city: "Perth", postcodePrefix: "6" },
  SA: { city: "Adelaide", postcodePrefix: "5" },
  TAS: { city: "Hobart", postcodePrefix: "7" },
  ACT: { city: "Canberra", postcodePrefix: "0" },
  NT: { city: "Darwin", postcodePrefix: "0" },
};

/** Generates one deterministic, realistic business for the given seed and region (ID by default). */
export function generateBusiness(params: GenerateBusinessParams): Business {
  const faker = createSeededFaker(params.seed);
  const region = params.region ?? "ID";
  const displayName = generateMerchantName(faker);
  const roles = faker.helpers.arrayElements(ALL_ROLES, { min: 1, max: ALL_ROLES.length });
  const id = faker.string.uuid();

  if (region === "AU") {
    const state = faker.helpers.arrayElement(AU_STATES);
    const { postcodePrefix } = AU_CITIES_BY_STATE[state];
    const postcode = `${postcodePrefix}${faker.string.numeric(3)}`;
    return businessSchema.parse({
      id,
      legalName: `${displayName} Pty Ltd`,
      displayName,
      taxIdKind: "ABN",
      taxIdValue: faker.string.numeric(11),
      addressState: state,
      addressPostcode: postcode,
      addressCity: null,
      roles,
      isVerified: faker.datatype.boolean({ probability: 0.8 }),
      logoUrl: faker.datatype.boolean({ probability: 0.6 }) ? faker.image.urlPicsumPhotos() : null,
      region: "AU",
      currency: "AUD",
      handle: handleFrom(displayName, id.slice(0, 8)),
      coverUrl: faker.datatype.boolean({ probability: 0.5 }) ? faker.image.urlPicsumPhotos() : null,
    });
  }

  const idTaxIdKind = faker.helpers.arrayElement(["NIB", "NPWP"] as const);
  return businessSchema.parse({
    id,
    legalName: `PT ${displayName} Indonesia`,
    displayName,
    taxIdKind: idTaxIdKind,
    taxIdValue: idTaxIdKind === "NIB" ? faker.string.numeric(13) : faker.string.numeric(16),
    addressState: null,
    addressPostcode: null,
    addressCity: "Jakarta",
    roles,
    isVerified: faker.datatype.boolean({ probability: 0.8 }),
    logoUrl: faker.datatype.boolean({ probability: 0.6 }) ? faker.image.urlPicsumPhotos() : null,
    region: "ID",
    currency: "IDR",
    handle: handleFrom(displayName, id.slice(0, 8)),
    coverUrl: faker.datatype.boolean({ probability: 0.5 }) ? faker.image.urlPicsumPhotos() : null,
  });
}

/** Generates `count` deterministic businesses from a base seed. */
export function generateBusinesses(count: number, baseSeed: number): Business[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateBusiness({ seed: baseSeed + index }),
  );
}

/** A business with a deliberately long, real-sounding name — the merchant-name awkward fixture. */
export const longNameBusinessFixture: Business = businessSchema.parse({
  id: "00000000-0000-4000-8000-000000000601",
  legalName: `PT ${LONG_MERCHANT_NAME} Indonesia`,
  displayName: LONG_MERCHANT_NAME,
  taxIdKind: "NPWP",
  taxIdValue: "1234567890123456",
  addressState: null,
  addressPostcode: null,
  addressCity: "Jakarta",
  roles: ["advertiser", "supplier"],
  isVerified: true,
  logoUrl: null,
  region: "ID",
  currency: "IDR",
  handle: "long-name-fixture-601",
  coverUrl: null,
});

export const mockBusinesses: Business[] = generateBusinesses(12, 4_000);
