import type { Business, BusinessRole } from "./business";
import { businessSchema } from "./business";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME, generateMerchantName, pickDistrict } from "../internal/jakarta";

export interface GenerateBusinessParams {
  seed: number;
}

const ALL_ROLES: readonly BusinessRole[] = ["advertiser", "supplier", "redeemer"];

/** Generates one deterministic, realistic Jakarta business for the given seed. */
export function generateBusiness(params: GenerateBusinessParams): Business {
  const faker = createSeededFaker(params.seed);
  const displayName = generateMerchantName(faker);
  const roles = faker.helpers.arrayElements(ALL_ROLES, { min: 1, max: ALL_ROLES.length });

  return businessSchema.parse({
    id: faker.string.uuid(),
    legalName: `PT ${displayName} Indonesia`,
    displayName,
    district: pickDistrict(faker),
    roles,
    isVerified: faker.datatype.boolean({ probability: 0.8 }),
    logoUrl: faker.datatype.boolean({ probability: 0.6 }) ? faker.image.urlPicsumPhotos() : null,
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
});

export const mockBusinesses: Business[] = generateBusinesses(12, 4_000);
