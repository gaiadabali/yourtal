#!/usr/bin/env node
/**
 * Renders the YourTal brand mark to every static icon file the app needs
 * (task 3.6.a) and commits the OUTPUT, not this script, to the tree — a
 * build never runs this. Run it by hand after changing the mark:
 *
 *   node apps/web/scripts/build-brand-icons.mjs
 *
 * The mark drawn here is the exact glyph in `packages/ui/src/brand/coin-mark.tsx`
 * (circle rim + squiggle in the same 0..16 coordinate space), just scaled by an
 * SVG transform and given real fill colours instead of `currentColor` — a
 * static PNG/ICO has no CSS to inherit from. Raw hex is fine here and only
 * here (and in the generated asset files themselves): everywhere else in the
 * app, colour comes from the Tailwind tokens in `packages/ui/src/styles`.
 *
 * `--gold-400` (coin fill), `--gold-950` (rim/glyph, the same pairing
 * `PointsChip` uses as `bg-points`/`text-fg-on-points`) and `--ink-950` (the
 * "After Dark" canvas, `--color-canvas`'s dark value) are read from
 * `packages/ui/src/styles/tokens.css` by eye, not computed, because this
 * script has no CSS engine — a comment here would drift silently if the
 * token changed there, so `build-brand-icons.test.mjs`-style drift
 * protection is intentionally skipped in favour of the visual gallery
 * section (`app/(lab)/lab/ui/groups/brand.tsx`), which anyone can eyeball.
 *
 * Rasterising: Playwright's installed Chrome (`channel: "chrome"`, already
 * used by `playwright.rendered.config.ts`) draws the SVG in a real browser
 * and `Locator.screenshot()` crops to exactly the element's box — no page
 * chrome, no viewport rounding.
 *
 * Packing the ICO by hand: an ICO with embedded PNG frames (not raw BMP
 * DIBs) is just a 6-byte header, one 16-byte directory entry per image, and
 * the PNG bytes back to back — a real dependency would be a lot of code for
 * a format this small.
 */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GOLD = "#FFC53D"; // --gold-400 / --color-points
const RIM = "#1A1300"; // --gold-950 / --color-fg-on-points
const CANVAS = "#0B0B0F"; // --ink-950 / --color-canvas (dark, "After Dark")

/**
 * The coin, exactly as drawn in `coin-mark.tsx`, wrapped in a transform so
 * it can be scaled and centred inside any box without touching its own
 * coordinates. `coinDiameter` is the rendered diameter, in the same units
 * as `box`.
 */
function coinGroup({ box, coinDiameter, rim }) {
  const scale = coinDiameter / 13; // circle r=6.5 -> diameter 13 in the source's 16x16 space
  const offset = (box - 16 * scale) / 2;
  const rimStroke = rim ? `stroke="${RIM}" stroke-width="${(0.7 / scale).toFixed(3)}"` : "";
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">
    <circle cx="8" cy="8" r="6.5" fill="${GOLD}" ${rimStroke} />
    <path d="M5.8 6c0-.9.9-1.6 2.2-1.6s2.2.6 2.2 1.4c0 1.7-4.4.9-4.4 2.7 0 .8 1 1.5 2.2 1.5s2.2-.7 2.2-1.6M8 3.6v8.8"
      stroke="${RIM}" stroke-width="1.1" stroke-linecap="round" fill="none" />
  </g>`;
}

/**
 * @param {{box:number, bg:string|null, coinDiameterRatio:number, rim?:boolean}} opts
 * `bg: null` leaves the canvas transparent (favicon, icon.svg); a colour
 * fills it edge to edge (apple/PWA icons, which iOS and Android otherwise
 * render on an OS-chosen background — never transparent by omission).
 */
function iconSvg({ box, bg, coinDiameterRatio, rim = true }) {
  const bgRect = bg ? `<rect width="${box}" height="${box}" fill="${bg}" />` : "";
  const coin = coinGroup({ box, coinDiameter: box * coinDiameterRatio, rim });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${bgRect}${coin}</svg>`;
}

/** Renders one SVG string to a PNG buffer at exactly its declared box size. */
async function rasterise(page, svg) {
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  const locator = page.locator("svg");
  return locator.screenshot({ omitBackground: true });
}

/** Packs same-format PNG frames into a single .ico (PNG-in-ICO, not BMP). */
function packIco(frames) {
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  const bodies = [];
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width, 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // colour count: none (>=8bpp)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // offset from file start
    offset += png.length;
    entries.push(entry);
    bodies.push(png);
  }
  return Buffer.concat([header, ...entries, ...bodies]);
}

async function main() {
  const iconsDir = path.join(appDir, "public", "icons");
  await mkdir(iconsDir, { recursive: true });

  // `icon.svg` is served as-is (no rasterisation): vector, so it is crisp at
  // every size a browser tab or bookmark bar asks for.
  const svgIcon = iconSvg({ box: 32, bg: null, coinDiameterRatio: 0.85 });
  await writeFile(path.join(appDir, "app", "icon.svg"), svgIcon, "utf8");

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();

    // favicon.ico: three sizes, transparent, packed into one file.
    const favSizes = [16, 32, 48];
    const favFrames = [];
    for (const size of favSizes) {
      const svg = iconSvg({ box: size, bg: null, coinDiameterRatio: 0.9 });
      const png = await rasterise(page, svg);
      favFrames.push({ size, png });
    }
    await writeFile(path.join(appDir, "app", "favicon.ico"), packIco(favFrames));

    // apple-icon.png: iOS never shows transparency, so this gets the
    // After Dark canvas fill, same as every other opaque app icon below.
    const appleSvg = iconSvg({ box: 180, bg: CANVAS, coinDiameterRatio: 0.62 });
    await writeFile(path.join(appDir, "app", "apple-icon.png"), await rasterise(page, appleSvg));

    // PWA icons, "any" purpose: same look as apple-icon, standard sizes.
    for (const size of [192, 512]) {
      const svg = iconSvg({ box: size, bg: CANVAS, coinDiameterRatio: 0.62 });
      await writeFile(path.join(iconsDir, `icon-${size}.png`), await rasterise(page, svg));
    }

    // Maskable 512: opaque, and the mark kept well inside Android's 80%
    // safe-zone circle so no OS mask shape ever clips the coin.
    const maskableSvg = iconSvg({ box: 512, bg: CANVAS, coinDiameterRatio: 0.42 });
    await writeFile(
      path.join(iconsDir, "icon-512-maskable.png"),
      await rasterise(page, maskableSvg),
    );
  } finally {
    await browser.close();
  }

  console.log("[build-brand-icons] wrote app/icon.svg, app/favicon.ico, app/apple-icon.png,");
  console.log(
    "[build-brand-icons]   public/icons/icon-192.png, icon-512.png, icon-512-maskable.png",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
