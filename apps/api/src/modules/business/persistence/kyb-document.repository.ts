import type { KybDocument, KybDocumentType } from "@yourtal/contracts/business/kyb-document";

export interface SubmitKybDocumentInput {
  readonly businessId: string;
  readonly documentType: KybDocumentType;
  readonly storageRef: string;
  readonly expiresAt: string | null;
}

export interface KybDocumentRepository {
  submit(input: SubmitKybDocumentInput): Promise<KybDocument>;
  listByBusiness(businessId: string): Promise<KybDocument[]>;
}

export const KYB_DOCUMENT_REPOSITORY = Symbol("KYB_DOCUMENT_REPOSITORY");
