export interface PartnerCredentialRow {
  readonly partnerId: string;
  readonly secret: string;
}

export interface PartnerCredentialRepository {
  findById(partnerId: string): Promise<PartnerCredentialRow | null>;
}

export const PARTNER_CREDENTIAL_REPOSITORY = Symbol("PARTNER_CREDENTIAL_REPOSITORY");
