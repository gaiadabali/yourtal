import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { partnerCredentials } from "./schema/partner.table";
import type {
  PartnerCredentialRepository,
  PartnerCredentialRow,
} from "./partner-credential.repository";

export class DrizzlePartnerCredentialRepository implements PartnerCredentialRepository {
  constructor(private readonly db: AppDb) {}

  async findById(partnerId: string): Promise<PartnerCredentialRow | null> {
    const [row] = await this.db
      .select()
      .from(partnerCredentials)
      .where(eq(partnerCredentials.partnerId, partnerId))
      .limit(1);
    return row ?? null;
  }
}
