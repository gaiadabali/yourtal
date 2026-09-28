export interface PartnerCredentialRow {
  readonly partnerId: string;
  /** TASKS.md 8.4.d: the env var NAME holding this partner's HMAC key — never the key itself. */
  readonly secretEnvVar: string;
}

export interface PartnerCredentialRepository {
  findById(partnerId: string): Promise<PartnerCredentialRow | null>;
}

export const PARTNER_CREDENTIAL_REPOSITORY = Symbol("PARTNER_CREDENTIAL_REPOSITORY");
