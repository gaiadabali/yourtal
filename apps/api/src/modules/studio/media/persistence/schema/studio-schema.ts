import { pgSchema } from "drizzle-orm/pg-core";

/**
 * One Postgres schema per Nest module (docs/13b section 7, docs/15).
 * Applied by `packages/db/migrations/20260927150000_studio_media_assets.sql`.
 */
export const studioPgSchema = pgSchema("studio");
