/**
 * Deterministic placeholder art for the gallery: an inline SVG data URL, no
 * network fetch, no external asset — same origin rule for lab images. The
 * hue is derived from the seed so different demo rows look visibly distinct
 * without needing real photography.
 */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function placeholderImage(seed: string, width: number, height: number): string {
  const hue = hashSeed(seed) % 360;
  const hue2 = (hue + 42) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 65% 32%)"/>` +
    `<stop offset="100%" stop-color="hsl(${hue2} 65% 16%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
