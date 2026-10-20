import { and, eq, gt, isNull } from "drizzle-orm";
import { regionSchema } from "@yourtal/contracts/region";
import { linkCodes } from "../../me/persistence/schema/me-schema";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { ClaimedLinkCode, LinkCodeLookup } from "./link-code-lookup";

export class DrizzleLinkCodeLookup implements LinkCodeLookup {
  constructor(private readonly db: AppDb) {}

  async claim(code: string): Promise<ClaimedLinkCode | null> {
    const now = new Date();
    const [row] = await this.db
      .update(linkCodes)
      .set({ consumedAt: now })
      .where(
        and(eq(linkCodes.code, code), isNull(linkCodes.consumedAt), gt(linkCodes.expiresAt, now)),
      )
      .returning({ userId: linkCodes.userId, region: linkCodes.region });
    if (row === undefined) return null;
    return { userId: row.userId, region: regionSchema.parse(row.region) };
  }
}
