import { eq } from "drizzle-orm";
import { regionSchema } from "@yourtal/contracts/region";
import { linkCodes } from "../../me/persistence/schema/me-schema";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { LinkCodeLookup, ResolvedLinkCode } from "./link-code-lookup";

export class DrizzleLinkCodeLookup implements LinkCodeLookup {
  constructor(private readonly db: AppDb) {}

  async resolve(code: string): Promise<ResolvedLinkCode | null> {
    const [row] = await this.db.select().from(linkCodes).where(eq(linkCodes.code, code)).limit(1);
    if (row === undefined) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { userId: row.userId, region: regionSchema.parse(row.region) };
  }
}
