import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCKUP_PATH, MARK_PATH, MASCOT_PATH } from "@yourtal/ui/brand/brand-paths";

const file = (name: string) => readFileSync(join(process.cwd(), "public", "brand", name), "utf8");

describe("static brand art in public/brand", () => {
  // The components serve these files; node scripts/build-brand-icons.mjs rewrites them
  // from brand-paths.ts. A path edited in one place and not the other fails here.
  it.each([
    ["yourtal-lockup.svg", LOCKUP_PATH],
    ["yourtal-mark.svg", MARK_PATH],
    ["yourtal-mascot.svg", MASCOT_PATH],
  ])("%s matches brand-paths.ts and is Play Yellow", (name, path) => {
    const svg = file(name);
    expect(svg).toContain(`d="${path}"`);
    expect(svg).toContain('fill="#FFDA00"');
  });
});
