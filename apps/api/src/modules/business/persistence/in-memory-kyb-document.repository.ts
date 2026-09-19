import { randomUUID } from "node:crypto";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import type { InMemoryBusinessStore } from "./in-memory-business-store";
import type { KybDocumentRepository, SubmitKybDocumentInput } from "./kyb-document.repository";

export class InMemoryKybDocumentRepository implements KybDocumentRepository {
  constructor(private readonly store: InMemoryBusinessStore) {}

  submit(input: SubmitKybDocumentInput): Promise<KybDocument> {
    const document: KybDocument = {
      id: randomUUID(),
      businessId: input.businessId,
      documentType: input.documentType,
      storageRef: input.storageRef,
      status: "submitted",
      // Normalized through `Date` the same way the Drizzle implementation's
      // `timestamptz` round trip would, so the two backends cannot disagree
      // on format for callers switching between them.
      expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt).toISOString(),
      submittedAt: new Date().toISOString(),
      verifiedAt: null,
      verifiedByUserId: null,
    };
    const existing = this.store.kybDocuments.get(input.businessId) ?? [];
    this.store.kybDocuments.set(input.businessId, [...existing, document]);
    return Promise.resolve(document);
  }

  listByBusiness(businessId: string): Promise<KybDocument[]> {
    return Promise.resolve(this.store.kybDocuments.get(businessId) ?? []);
  }
}
