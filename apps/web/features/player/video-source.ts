/**
 * KNOWN GAP — flag for a follow-up ticket, same category as chapter.ts:
 * `packages/contracts`'s `campaignSchema` has no video-source field at all
 * (no HLS manifest URL, no per-quality rendition list, no Cloudflare
 * Stream/R2 identifier). Phase U is mock-only (docs/tasks/phase-u-ui.md
 * phase preamble) and there is no real per-campaign encode to point the
 * player at, so every campaign in this app plays the SAME publicly hosted
 * Apple HLS reference stream. That asset was chosen deliberately over an
 * arbitrary single-bitrate file: `bipbop_16x9_variant.m3u8` ships a real
 * multi-bitrate ABR ladder, so the quality selector has something genuine
 * to switch between via hls.js's `currentLevel`, rather than faking a
 * quality switch that does nothing.
 *
 * This is a placeholder, not a design decision. Once `campaign.ts` gains a
 * real source field (and, ideally, real per-campaign renditions):
 *   1. delete this file and wire the campaign's own URL through
 *      `get-watch-campaign.ts` / `use-watch-session.ts`;
 *   2. delete `time-remap.ts`, which exists only because this shared
 *      asset's real runtime has nothing to do with any campaign's
 *      advertised duration.
 */
export const MOCK_HLS_MANIFEST_URL =
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8";
