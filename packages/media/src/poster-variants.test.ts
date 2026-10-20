import { describe, expect, it } from "vitest";
import {
  POSTER_LONG_SIDES,
  posterKeyOf,
  posterVariantKey,
  posterVariantsFor,
  posterWidth,
} from "./poster-variants";

const ID = "17702653-fc8d-52f6-9ec8-76e56acef91f";
const ORIGIN = "https://yourtal.gaiada.com/media";

describe("poster variants", () => {
  it("keeps the 640 under the original key and puts the others beside it", () => {
    const base = `posters/${ID}.jpg`;
    expect(posterVariantKey(base, 640)).toBe(base);
    expect(posterVariantKey(base, 320)).toBe(`posters/${ID}-320.jpg`);
    expect(posterVariantKey(base, 960)).toBe(`posters/${ID}-960.jpg`);
  });

  it("lists the sizes it is given, smallest first, with the real pixel width", () => {
    const landscape = posterVariantsFor(`${ORIGIN}/posters/${ID}.jpg`, "16:9", [960, 320, 640]);
    expect(landscape).toEqual([
      { url: `${ORIGIN}/posters/${ID}-320.jpg`, width: 320 },
      { url: `${ORIGIN}/posters/${ID}.jpg`, width: 640 },
      { url: `${ORIGIN}/posters/${ID}-960.jpg`, width: 960 },
    ]);
    // A 9:16 poster's long side is its height, so it is narrower than its size.
    expect(
      posterVariantsFor(`${ORIGIN}/posters/${ID}.jpg`, "9:16", [320, 640, 960]).map((v) => v.width),
    ).toEqual([180, 360, 540]);
    // Only what was uploaded is listed.
    expect(posterVariantsFor(`${ORIGIN}/posters/${ID}.jpg`, "16:9", [320, 640])).toHaveLength(2);
    expect(posterVariantsFor(`${ORIGIN}/posters/${ID}.jpg`, "16:9", [])).toEqual([]);
    expect(POSTER_LONG_SIDES.map((side) => posterWidth(side, "9:16"))).toEqual([180, 360, 540]);
  });

  it("gives nothing for a poster the pipeline did not make", () => {
    for (const url of [
      `${ORIGIN}/posters/snap-app-30s.jpg`,
      `${ORIGIN}/posters/listings/${ID}/cover.jpg`,
      `${ORIGIN}/posters/${ID}-320.jpg`,
      "https://cdn.example.com/poster.jpg",
    ]) {
      expect(posterVariantsFor(url, "16:9", [320, 640, 960])).toEqual([]);
    }
    expect(posterVariantKey("posters/snap-app-30s.jpg", 320)).toBeNull();
  });

  it("finds the key of one of our poster URLs", () => {
    expect(posterKeyOf(`${ORIGIN}/posters/${ID}.jpg`)).toBe(`posters/${ID}.jpg`);
    expect(posterKeyOf("https://cdn.example.com/poster.jpg")).toBeNull();
  });
});
