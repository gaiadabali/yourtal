import type pg from "pg";

/**
 * Demo listings were seeded with placeholder images that were never uploaded
 * (and a loopback host that only ever meant local dev), so the Store showed
 * broken images to everyone. Each such listing takes its own business's
 * newest campaign poster instead: real, already served, and on the right
 * host for the environment. Runs every deploy; a no-op once repaired.
 */
const PLACEHOLDER_KEYS = ["/listings/demo-media-placeholder.jpg", "/listings/snap-app-au-demo.jpg"];

export async function repairDemoListingImages(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<{ repaired: number }> {
  const result = await pool.query(
    `UPDATE store.listings l
        SET image_url = poster.poster_url
       FROM (
              SELECT DISTINCT ON (business_id) business_id, poster_url
                FROM campaign.campaigns
               WHERE poster_url IS NOT NULL AND lifecycle_state = 'live'
               ORDER BY business_id, published_at DESC NULLS LAST
            ) poster
      WHERE poster.business_id = l.merchant_id
        AND (${PLACEHOLDER_KEYS.map((_, i) => `l.image_url LIKE $${String(i + 1)}`).join(" OR ")})`,
    PLACEHOLDER_KEYS.map((key) => `%${key}`),
  );
  const repaired = result.rowCount ?? 0;
  if (repaired > 0) {
    log(`[seed:demo-listing-images] ${String(repaired)} listings now show their business's poster`);
  }
  return { repaired };
}
