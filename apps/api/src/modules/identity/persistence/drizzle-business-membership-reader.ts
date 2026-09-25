import { and, eq, isNotNull } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { businessMembershipsView } from "./schema/business-membership-view.table";
import type { BusinessMembershipReader, BusinessMembershipSummary } from "./business-membership-reader";

export class DrizzleBusinessMembershipReader implements BusinessMembershipReader {
  constructor(private readonly db: AppDb) {}

  async listForUser(userId: string): Promise<readonly BusinessMembershipSummary[]> {
    const rows = await this.db
      .select({ businessId: businessMembershipsView.businessId, role: businessMembershipsView.role })
      .from(businessMembershipsView)
      .where(
        and(eq(businessMembershipsView.userId, userId), isNotNull(businessMembershipsView.joinedAt)),
      );
    return rows;
  }
}
