/**
 * The GOD group's own link, for the "A GOD company" line and the switcher's footer. Kept apart from
 * the brand list so the footer never pulls the list into a page's first load. Mirrors `god` in
 * https://god.gaiada.com/brands.json; `brands.test.ts` fails on drift.
 */
export const GOD = {
  name: "GOD",
  fullName: "Global Omni Data",
  label: "A GOD company",
  url: "https://god.gaiada.com",
} as const;
