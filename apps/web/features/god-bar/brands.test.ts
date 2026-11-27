import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pinned from "./brands.pinned.json";
import enAU from "@/messages/en-AU/godBar.json";
import idID from "@/messages/id-ID/godBar.json";
import { BRAND_ICONS, CURRENT_BRAND, GOD_BRANDS } from "./brands";
import { GOD } from "./god";

// `brands.pinned.json` is a copy of https://god.gaiada.com/brands.json. When the canonical file
// changes, copy it here and update `brands.ts` and the catalogues; this test fails until all agree.
describe("the GOD brand list", () => {
  it("matches the pinned copy of the canonical brands.json", () => {
    expect(GOD).toEqual({
      name: pinned.god.name,
      fullName: pinned.god.fullName,
      label: pinned.god.label,
      url: pinned.god.url,
    });
    expect(GOD_BRANDS).toEqual(
      pinned.brands.map((brand) => ({
        key: brand.key,
        name: brand.name,
        purpose: brand.purpose,
        url: brand.url,
        appUrl: brand.appUrl,
        ...("inApp" in brand ? { inApp: brand.inApp } : {}),
        adultsOnly: brand.adultsOnly,
      })),
    );
  });

  it("keeps the English catalogue on the canonical purpose lines", () => {
    for (const brand of pinned.brands) {
      expect(enAU.brands[brand.key as keyof typeof enAU.brands]).toBe(brand.purpose);
    }
  });

  it("has an Indonesian line for every brand", () => {
    for (const brand of GOD_BRANDS) {
      expect(idID.brands[brand.key].length).toBeGreaterThan(0);
    }
  });

  it("names this app, and puts no token or tracking parameter in any link", () => {
    expect(GOD_BRANDS.some((brand) => brand.key === CURRENT_BRAND)).toBe(true);
    for (const url of [GOD.url, ...GOD_BRANDS.flatMap((b) => [b.url, b.appUrl ?? ""])]) {
      expect(url).not.toMatch(/[?#]/);
    }
  });

  it("has a static icon in public/ for every brand", () => {
    for (const brand of GOD_BRANDS) {
      const file = path.join(process.cwd(), "public", BRAND_ICONS[brand.key]);
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("<svg");
    }
  });
});
