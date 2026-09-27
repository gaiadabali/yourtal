import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { counterAuthorizationMeta } from "./schema/counter-authorization-meta.table";
import type {
  AuthorizationMeta,
  AuthorizationMetaRepository,
} from "./authorization-meta.repository";

export class DrizzleAuthorizationMetaRepository implements AuthorizationMetaRepository {
  constructor(private readonly db: AppDb) {}

  async save(meta: AuthorizationMeta): Promise<void> {
    await this.db.insert(counterAuthorizationMeta).values(meta).onConflictDoNothing();
  }

  async takeByAuthorizationId(authorizationId: string): Promise<AuthorizationMeta | null> {
    const [row] = await this.db
      .delete(counterAuthorizationMeta)
      .where(eq(counterAuthorizationMeta.authorizationId, authorizationId))
      .returning();
    if (row === undefined) return null;
    return {
      authorizationId: row.authorizationId,
      deviceId: row.deviceId,
      businessId: row.businessId,
      locationId: row.locationId,
      orderRef: row.orderRef,
      orderTotalMinor: row.orderTotalMinor,
    };
  }
}
