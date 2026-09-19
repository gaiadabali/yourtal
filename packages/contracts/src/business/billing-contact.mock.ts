import type { BillingContact } from "./billing-contact";
import { billingContactSchema } from "./billing-contact";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";

export interface GenerateBillingContactParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic billing contact for the given seed. */
export function generateBillingContact(params: GenerateBillingContactParams): BillingContact {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);
  const updatedDaysAgo = faker.number.int({ min: 0, max: 60 });

  return billingContactSchema.parse({
    businessId: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    phone: `+62${faker.string.numeric({ length: 10, allowLeadingZeros: false })}`,
    updatedAt: toIsoString(addDays(now, -updatedDaysAgo)),
  });
}

/** Generates `count` deterministic billing contacts from a base seed. */
export function generateBillingContacts(
  count: number,
  baseSeed: number,
  now?: Date,
): BillingContact[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateBillingContact({ seed: baseSeed + index, now }),
  );
}

/** A billing contact with an Australian phone number — the non-Indonesian awkward case. */
export const australianBillingContactFixture: BillingContact = billingContactSchema.parse({
  businessId: "00000000-0000-4000-8000-000000000601",
  name: "Jordan Whitfield",
  email: "finance@example.com.au",
  phone: "+61412345678",
  updatedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

export const mockBillingContacts: BillingContact[] = generateBillingContacts(8, 8_000);
