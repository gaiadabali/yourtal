export interface DeveloperCredentialRow {
  readonly credentialId: string;
  readonly businessId: string;
  readonly label: string;
  readonly sandbox: boolean;
  readonly state: "active" | "revoked";
  readonly issuedBy: string;
  readonly createdAt: Date;
}

export interface CreateDeveloperCredentialInput {
  readonly credentialId: string;
  readonly businessId: string;
  readonly label: string;
  readonly sandbox: boolean;
  readonly issuedBy: string;
}

export interface DeveloperCredentialRepository {
  create(input: CreateDeveloperCredentialInput): Promise<DeveloperCredentialRow>;
  findById(credentialId: string): Promise<DeveloperCredentialRow | null>;
  listForBusiness(businessId: string): Promise<readonly DeveloperCredentialRow[]>;
  markRevoked(credentialId: string): Promise<void>;
}

export const DEVELOPER_CREDENTIAL_REPOSITORY = Symbol("DEVELOPER_CREDENTIAL_REPOSITORY");
