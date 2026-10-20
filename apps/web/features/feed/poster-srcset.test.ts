import { describe, expect, it } from "vitest";
import { posterCardProps, posterImgProps, posterSrcSet } from "./poster-srcset";

const variants = [
  { url: "https://m.example/posters/a-320.jpg", width: 320 },
  { url: "https://m.example/posters/a.jpg", width: 640 },
  { url: "https://m.example/posters/a-960.jpg", width: 960 },
];

describe("posterSrcSet", () => {
  it("writes each size as `url <width>w`, in the order given", () => {
    expect(posterSrcSet(variants)).toBe(
      "https://m.example/posters/a-320.jpg 320w, https://m.example/posters/a.jpg 640w, https://m.example/posters/a-960.jpg 960w",
    );
  });

  it("gives nothing when there is no choice to make", () => {
    expect(posterSrcSet([])).toBeUndefined();
    expect(posterSrcSet(variants.slice(0, 1))).toBeUndefined();
    expect(posterImgProps([], "100vw")).toEqual({});
    expect(posterCardProps([], "100vw")).toEqual({});
  });

  it("names the attributes for an <img> and for the UI cards", () => {
    expect(posterImgProps(variants, "50vw")).toEqual({
      srcSet: posterSrcSet(variants),
      sizes: "50vw",
    });
    expect(posterCardProps(variants, "50vw")).toEqual({
      posterSrcSet: posterSrcSet(variants),
      posterSizes: "50vw",
    });
  });
});
