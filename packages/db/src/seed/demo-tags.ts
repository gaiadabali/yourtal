import { createHash } from "node:crypto";
import type pg from "pg";
import { INTEREST_TAXONOMY } from "@yourtal/contracts/interest/taxonomy";

/**
 * 13.11.c: every demo campaign and listing gets 2–5 tags from the interest
 * taxonomy, drawn from its own category's branch so they are honest about
 * the content. Deterministic per row id and idempotent: only rows still
 * carrying no tags are touched, so a business's own tags are never replaced.
 */
const MIN_TAGS = 2;
const MAX_TAGS = 5;

/** A category's branch: the node itself (if it is one), its parent, its children and siblings. */
export function tagPoolFor(contentCategory: string): string[] {
  const node = INTEREST_TAXONOMY.get(contentCategory);
  if (node === undefined) return [];
  const pool = new Set<string>([node.id]);
  for (const other of INTEREST_TAXONOMY.values()) {
    // Declared-only (1.1.e): never assigned as a tag on anyone's behalf.
    if (other.id === "family-young-children") continue;
    if (other.parent === node.id) pool.add(other.id);
    if (node.parent !== null && (other.id === node.parent || other.parent === node.parent)) {
      pool.add(other.id);
    }
  }
  return [...pool];
}

/** 2–5 tags for one row, stable across runs. The category's own node always comes first. */
export function demoTagsFor(id: string, contentCategory: string): string[] {
  const pool = tagPoolFor(contentCategory);
  if (pool.length === 0) return [];
  const digest = createHash("sha256").update(id).digest();
  const want = Math.min(pool.length, MIN_TAGS + ((digest[0] ?? 0) % (MAX_TAGS - MIN_TAGS + 1)));
  const [first, ...rest] = pool;
  const shuffled = rest
    .map((tag, index) => ({ tag, key: digest[(index + 1) % digest.length] ?? 0 }))
    .sort((a, b) => a.key - b.key || a.tag.localeCompare(b.tag))
    .map((entry) => entry.tag);
  return [first as string, ...shuffled].slice(0, want);
}

export interface DemoTagCounts {
  readonly campaigns: number;
  readonly listings: number;
}

export async function backfillDemoTags(pool: pg.Pool): Promise<DemoTagCounts> {
  let campaigns = 0;
  const campaignRows = await pool.query<{ id: string; content_category: string }>(
    `SELECT id, content_category FROM campaign.campaigns WHERE declared_interests = '[]'::jsonb`,
  );
  for (const row of campaignRows.rows) {
    const tags = demoTagsFor(row.id, row.content_category);
    if (tags.length === 0) continue;
    await pool.query(`UPDATE campaign.campaigns SET declared_interests = $2::jsonb WHERE id = $1`, [
      row.id,
      JSON.stringify(tags),
    ]);
    campaigns += 1;
  }

  let listings = 0;
  const listingRows = await pool.query<{ id: string; content_category: string }>(
    `SELECT id, content_category FROM store.listings WHERE tags = '[]'::jsonb`,
  );
  for (const row of listingRows.rows) {
    const tags = demoTagsFor(row.id, row.content_category);
    if (tags.length === 0) continue;
    await pool.query(`UPDATE store.listings SET tags = $2::jsonb WHERE id = $1`, [
      row.id,
      JSON.stringify(tags),
    ]);
    listings += 1;
  }
  return { campaigns, listings };
}
