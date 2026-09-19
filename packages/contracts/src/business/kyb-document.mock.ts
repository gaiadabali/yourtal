import type { KybDocument, KybDocumentStatus } from "./kyb-document";
import { kybDocumentSchema } from "./kyb-document";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";

export interface GenerateKybDocumentParams {
  seed: number;
  now?: Date | undefined;
}

const ALL_DOCUMENT_TYPES = [
  "business_registration_certificate",
  "tax_registration_number",
  "director_identity",
  "proof_of_address",
] as const;

const ALL_STATUSES: readonly KybDocumentStatus[] = ["submitted", "verified", "rejected", "expired"];

/** Generates one deterministic, realistic KYB document submission for the given seed. */
export function generateKybDocument(params: GenerateKybDocumentParams): KybDocument {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const submittedDaysAgo = faker.number.int({ min: 0, max: 120 });
  const status = faker.helpers.arrayElement(ALL_STATUSES);
  const isVerified = status === "verified" || status === "expired";

  return kybDocumentSchema.parse({
    id: faker.string.uuid(),
    businessId: faker.string.uuid(),
    documentType: faker.helpers.arrayElement(ALL_DOCUMENT_TYPES),
    storageRef: `kms://kyb/${faker.string.alphanumeric({ length: 16, casing: "lower" })}`,
    status,
    expiresAt:
      status === "verified" || status === "expired"
        ? toIsoString(addDays(now, faker.number.int({ min: -30, max: 365 })))
        : null,
    submittedAt: toIsoString(addDays(now, -submittedDaysAgo)),
    verifiedAt: isVerified
      ? toIsoString(addDays(now, -submittedDaysAgo + faker.number.int({ min: 1, max: 5 })))
      : null,
    verifiedByUserId: isVerified ? faker.string.uuid() : null,
  });
}

/** Generates `count` deterministic KYB documents from a base seed. */
export function generateKybDocuments(count: number, baseSeed: number, now?: Date): KybDocument[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateKybDocument({ seed: baseSeed + index, now }),
  );
}

/** A rejected KYB submission with no expiry and no verifier — the rejected awkward case. */
export const rejectedKybDocumentFixture: KybDocument = kybDocumentSchema.parse({
  id: "00000000-0000-4000-8000-000000000801",
  businessId: "00000000-0000-4000-8000-000000000601",
  documentType: "proof_of_address",
  storageRef: "kms://kyb/rejected-fixture",
  status: "rejected",
  expiresAt: null,
  submittedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -10)),
  verifiedAt: null,
  verifiedByUserId: null,
});

export const mockKybDocuments: KybDocument[] = generateKybDocuments(8, 9_000);
