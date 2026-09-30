import type pg from "pg";

/**
 * Demo listings were seeded with placeholder images that were never uploaded
 * (and a loopback host that only ever meant local dev), so the Store showed
 * broken images to everyone. Each such listing takes its own business's
 * newest campaign poster instead: real, already served, and on the right
 * host for the environment. Runs every deploy; a no-op once repaired.
 */
const PLACEHOLDER_KEYS = [
  "/listings/demo-media-placeholder.jpg",
  "/listings/snap-app-au-demo.jpg",
  // The test-card poster an earlier run copied onto Snap App's listings.
  "/posters/attention-30s.jpg",
];

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

/**
 * Listing copy seeded before the copy rules were applied cited tickets and
 * tooling ("— Demo Voucher", "seeded by pnpm demo:media (7.2.e)"). Rewrite
 * it in each listing's own language. Runs every deploy; a no-op once clean.
 */
export async function repairDemoListingCopy(
  pool: pg.Pool,
  log: (message: string) => void,
): Promise<{ repaired: number }> {
  const titles = await pool.query(
    `UPDATE store.listings
        SET title = CASE
              WHEN title LIKE '% (affordable)' THEN merchant_name || ' starter voucher'
              WHEN title LIKE '% (terjangkau)' THEN 'Voucher hemat ' || merchant_name
              WHEN region = 'ID' THEN 'Voucher ' || merchant_name
              ELSE merchant_name || ' voucher'
            END
      WHERE title LIKE '% — Demo Voucher%' OR title LIKE '% — Voucher Demo%'`,
  );
  const descriptions = await pool.query(
    `UPDATE store.listings
        SET description = CASE WHEN region = 'ID'
              THEN 'Tukarkan di ' || merchant_name || '. Tunjukkan kodenya di kasir.'
              ELSE 'Redeem at ' || merchant_name || '. Show the code at the counter.'
            END
      WHERE description LIKE 'A demonstration voucher%'`,
  );
  const outlets = await pool.query(
    `UPDATE store.merchant_location SET name = replace(name, ' — Demo Outlet', '')
      WHERE name LIKE '% — Demo Outlet'`,
  );
  // Each voucher keeps its own copy of the title from when it was minted, so
  // the pre-minted demo batches still carried the old copy into wallets.
  // Best effort: the voucher schema is the voucher service's, and a refusal
  // must not stop the deploy.
  const vouchers = await pool
    .query(
      `UPDATE voucher.vouchers
        SET title = CASE
              WHEN title LIKE '% (affordable)' THEN merchant_name || ' starter voucher'
              WHEN title LIKE '% (terjangkau)' THEN 'Voucher hemat ' || merchant_name
              WHEN currency = 'IDR' THEN 'Voucher ' || merchant_name
              ELSE merchant_name || ' voucher'
            END
      WHERE title LIKE '% — Demo Voucher%' OR title LIKE '% — Voucher Demo%'`,
    )
    .catch((error: unknown) => {
      log(`[seed:demo-listing-copy] voucher titles left as they are: ${String(error)}`);
      return { rowCount: 0 };
    });
  // Demo businesses were seeded as @demo-au-bondi-board-co, and viewers see the
  // handle on channel pages and in search. Keep the brand part, unless another
  // business already holds it (handles are unique).
  const handles = await pool.query(
    `UPDATE business.business_accounts b
        SET handle = regexp_replace(b.handle, '^demo-(au|id)-', '')
      WHERE b.handle ~ '^demo-(au|id)-'
        AND NOT EXISTS (
          SELECT 1 FROM business.business_accounts o
           WHERE o.handle = regexp_replace(b.handle, '^demo-(au|id)-', '')
        )`,
  );
  const repaired =
    (handles.rowCount ?? 0) +
    (titles.rowCount ?? 0) +
    (descriptions.rowCount ?? 0) +
    (outlets.rowCount ?? 0) +
    (vouchers.rowCount ?? 0);
  if (repaired > 0) log(`[seed:demo-listing-copy] ${String(repaired)} listing texts rewritten`);
  return { repaired };
}
