#!/usr/bin/env node
/**
 * Renders the YourTal submark (the ribbon) to every static icon file the app needs and
 * commits the OUTPUT, not this script, to the tree: a build never runs this. Run it by
 * hand after changing the mark:
 *
 *   node apps/web/scripts/build-brand-icons.mjs
 *
 * The artwork is `MARK_PATH` in `packages/ui/src/brand/brand-paths.ts`, read from that
 * file so there is one source. Per the brand guide (p23) an app icon is the submark
 * only, no wordmark, kept inside the central 60% of a square tile: Play Yellow
 * (#FFDA00) on Charcoal (#363636), the brand ground. iOS and Android apply their own
 * corner masks, so the apple and PWA icons are full-bleed squares. Raw hex is fine here
 * and only here (and in the generated asset files): everywhere else in the app, colour
 * comes from the tokens in `packages/ui/src/styles`.
 *
 * Rasterising: Playwright's installed Chrome (`channel: "chrome"`, already used by
 * `playwright.rendered.config.ts`) draws the SVG in a real browser and
 * `Locator.screenshot()` crops to exactly the element's box.
 *
 * Packing the ICO by hand: an ICO with embedded PNG frames (not raw BMP DIBs) is just a
 * 6-byte header, one 16-byte directory entry per image, and the PNG bytes back to back.
 */

import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const YELLOW = "#FFDA00"; // --yellow-400 / --color-brand-logo (Play Yellow)
const GROUND = "#363636"; // --brand-charcoal / --color-brand-ground

const brandPaths = await readFile(
  path.resolve(appDir, "../../packages/ui/src/brand/brand-paths.ts"),
  "utf8",
);
const pick = (name) => {
  const match = new RegExp(String.raw`export const ${name} =\s*(?:"([^"]+)"|(\d+));`).exec(
    brandPaths,
  );
  if (!match) throw new Error(`${name} not found in brand-paths.ts`);
  return match[1] ?? Number(match[2]);
};
const MARK = { w: pick("MARK_WIDTH"), h: pick("MARK_HEIGHT"), d: pick("MARK_PATH") };

/**
 * The submark centred in a square `box`, `fill` of the box wide (the guide's 60% for app
 * icons; larger for a 16 px favicon, which would otherwise be a speck). `radius` rounds
 * the tile for icon.svg and the favicon, where nothing else masks the corners.
 */
function iconSvg({ box, fill, radius = 0 }) {
  const scale = (box * fill) / MARK.w;
  const x = (box - MARK.w * scale) / 2;
  const y = (box - MARK.h * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}"><rect width="${box}" height="${box}" rx="${radius}" fill="${GROUND}" /><g transform="translate(${x} ${y}) scale(${scale})"><path fill="${YELLOW}" fill-rule="evenodd" d="${MARK.d}" /></g></svg>`;
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
  const svgIcon = iconSvg({ box: 32, fill: 0.72, radius: 7 });
  await writeFile(path.join(appDir, "app", "icon.svg"), svgIcon, "utf8");

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();

    // favicon.ico: three sizes, packed into one file.
    const favSizes = [16, 32, 48];
    const favFrames = [];
    for (const size of favSizes) {
      const svg = iconSvg({ box: size, fill: 0.74, radius: Math.round(size * 0.22) });
      const png = await rasterise(page, svg);
      favFrames.push({ size, png });
    }
    await writeFile(path.join(appDir, "app", "favicon.ico"), packIco(favFrames));

    // apple-icon.png: iOS never shows transparency, so this gets the
    // Charcoal ground, same as every other opaque app icon below.
    const appleSvg = iconSvg({ box: 180, fill: 0.6 });
    await writeFile(path.join(appDir, "app", "apple-icon.png"), await rasterise(page, appleSvg));

    // PWA icons, "any" purpose: same look as apple-icon, standard sizes.
    for (const size of [192, 512]) {
      const svg = iconSvg({ box: size, fill: 0.6 });
      await writeFile(path.join(iconsDir, `icon-${size}.png`), await rasterise(page, svg));
    }

    // Maskable 512: opaque, and the mark kept well inside Android's 80%
    // safe-zone circle so no OS mask shape ever clips the ribbon.
    const maskableSvg = iconSvg({ box: 512, fill: 0.5 });
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
