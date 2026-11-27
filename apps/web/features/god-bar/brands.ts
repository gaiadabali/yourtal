/**
 * The GOD brands the app switcher lists. A small copy of https://god.gaiada.com/brands.json (the
 * canonical file): change names and URLs there first, then here. `brands.test.ts` compares both
 * with `brands.pinned.json`, a pinned copy of the canonical file, and fails on drift.
 * Only the switcher's panel imports this, so it loads on demand.
 */
export interface GodBrand {
  key: "yourtal" | "snapapp" | "ftr" | "spambank";
  name: string;
  /** The canonical English line. The screen shows the catalogue's `godBar.brands.<key>`. */
  purpose: string;
  url: string;
  /** Where the tile goes; `null` when the brand has no web app of its own. */
  appUrl: string | null;
  /** The tile opens this screen of the app you are already in. */
  inApp?: "mail";
  adultsOnly: boolean;
}

/** The app this build is. Its tile is marked, not linked. */
export const CURRENT_BRAND: GodBrand["key"] = "yourtal";

export const GOD_BRANDS: readonly GodBrand[] = [
  {
    key: "yourtal",
    name: "YourTal",
    purpose: "Watch, earn and spend locally",
    url: "https://yourtal.gaiada.com",
    appUrl: "https://yourtal.gaiada.com",
    adultsOnly: false,
  },
  {
    key: "snapapp",
    name: "SnapApps",
    purpose: "Scan and keep every receipt",
    url: "https://snapapp.gaiada.com",
    appUrl: "https://app.snapapps.gaiada.com",
    adultsOnly: false,
  },
  {
    key: "ftr",
    name: "Free Tax Returns",
    purpose: "Your free deduction worksheet",
    url: "https://freetaxreturns.com.au",
    appUrl: "https://freetaxreturns.com.au",
    adultsOnly: false,
  },
  {
    key: "spambank",
    name: "Spambank",
    purpose: "A spam-free address for sign-ups",
    url: "https://god.gaiada.com/brands/spambank/",
    appUrl: null,
    inApp: "mail",
    adultsOnly: true,
  },
];

/** Static icons in `public/god/` (brand-assets marks), fetched only when the panel opens. */
export const BRAND_ICONS: Record<GodBrand["key"], string> = {
  yourtal: "/brand/yourtal-mark.svg",
  snapapp: "/god/snapapps.svg",
  ftr: "/god/ftr.svg",
  spambank: "/god/spambank.svg",
};
