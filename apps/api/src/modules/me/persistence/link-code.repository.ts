import { eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { linkCodes } from "./schema/me-schema";

export interface LinkCode {
  readonly code: string;
  readonly userId: string;
  readonly region: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/** `me.link_code` (5.4.c) — a one-time code copied into snap-app (8.4). */
export interface LinkCodeRepository {
  create(code: LinkCode): Promise<void>;
  findByCode(code: string): Promise<LinkCode | null>;
}

export const LINK_CODE_REPOSITORY = Symbol("LINK_CODE_REPOSITORY");

export class DrizzleLinkCodeRepository implements LinkCodeRepository {
  constructor(private readonly db: AppDb) {}

  async create(code: LinkCode): Promise<void> {
    await this.db.insert(linkCodes).values({
      code: code.code,
      userId: code.userId,
      region: code.region,
      expiresAt: new Date(code.expiresAt),
      consumedAt: code.consumedAt === null ? null : new Date(code.consumedAt),
    });
  }

  async findByCode(code: string): Promise<LinkCode | null> {
    const rows = await this.db.select().from(linkCodes).where(eq(linkCodes.code, code)).limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      code: row.code,
      userId: row.userId,
      region: row.region,
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
    };
  }
}
