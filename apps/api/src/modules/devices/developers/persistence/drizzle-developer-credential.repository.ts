import { eq } from "drizzle-orm";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
import { merchantDeveloperCredentials } from "../schema/merchant-developer-credential.table";
import type {
  CreateDeveloperCredentialInput,
  DeveloperCredentialRepository,
  DeveloperCredentialRow,
} from "./developer-credential.repository";

function toRow(row: typeof merchantDeveloperCredentials.$inferSelect): DeveloperCredentialRow {
  return {
    credentialId: row.credentialId,
    businessId: row.businessId,
    label: row.label,
    sandbox: row.sandbox,
    state: row.state === "revoked" ? "revoked" : "active",
    issuedBy: row.issuedBy,
    createdAt: row.createdAt,
  };
}

export class DrizzleDeveloperCredentialRepository implements DeveloperCredentialRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: CreateDeveloperCredentialInput): Promise<DeveloperCredentialRow> {
    const [row] = await this.db.insert(merchantDeveloperCredentials).values(input).returning();
    if (row === undefined) {
      throw new Error("insert into business.merchant_developer_credential returned no row");
    }
    return toRow(row);
  }

  async findById(credentialId: string): Promise<DeveloperCredentialRow | null> {
    const [row] = await this.db
      .select()
      .from(merchantDeveloperCredentials)
      .where(eq(merchantDeveloperCredentials.credentialId, credentialId))
      .limit(1);
    return row === undefined ? null : toRow(row);
  }

  async listForBusiness(businessId: string): Promise<readonly DeveloperCredentialRow[]> {
    const rows = await this.db
      .select()
      .from(merchantDeveloperCredentials)
      .where(eq(merchantDeveloperCredentials.businessId, businessId));
    return rows.map(toRow);
  }

  async markRevoked(credentialId: string): Promise<void> {
    await this.db
      .update(merchantDeveloperCredentials)
      .set({ state: "revoked" })
      .where(eq(merchantDeveloperCredentials.credentialId, credentialId));
  }
}
