import type { Business, BusinessRole } from "./business";
import { businessSchema } from "./business";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME, generateMerchantName, pickDistrict } from "../internal/jakarta";

export interface GenerateBusinessParams {
  seed: number;
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

/** Generates one deterministic, realistic Jakarta business for the given seed. This roster is ID-only; an AU counterpart is C's to add alongside the AU studio surfaces (Phase 7). */
export function generateBusiness(params: GenerateBusinessParams): Business {
  const faker = createSeededFaker(params.seed);
  const displayName = generateMerchantName(faker);
  const roles = faker.helpers.arrayElements(ALL_ROLES, { min: 1, max: ALL_ROLES.length });
  const id = faker.string.uuid();

  return businessSchema.parse({
    id,
    legalName: `PT ${displayName} Indonesia`,
    displayName,
    district: pickDistrict(faker),
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
  district: "Kebayoran Baru",
  roles: ["advertiser", "supplier"],
  isVerified: true,
  logoUrl: null,
  region: "ID",
  currency: "IDR",
  handle: "long-name-fixture-601",
  coverUrl: null,
});

export const mockBusinesses: Business[] = generateBusinesses(12, 4_000);
