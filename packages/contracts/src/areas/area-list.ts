import type { Region } from "../region/region";

/**
 * F116: the fixed list of areas a viewer can declare and a campaign can
 * target. An area is a postcode; the suburb names are only how a person finds
 * it. Dependency-free, so client code can use the shapes and the postcode
 * check without pulling in Zod or the data (`area-data.ts` holds that and is
 * for the server only).
 */
export interface AreaPlace {
  /** The suburb or district a person recognises. */
  readonly name: string;
  readonly postcode: string;
}

export interface AreaState {
  readonly code: string;
  readonly name: string;
  readonly places: readonly AreaPlace[];
}

/** Four digits in Australia, five (kode pos) in Indonesia. */
const POSTCODE_SHAPE: Record<Region, RegExp> = {
  AU: /^[0-9]{4}$/,
  ID: /^[0-9]{5}$/,
};

export function isPostcodeShape(region: Region, value: string): boolean {
  return POSTCODE_SHAPE[region].test(value);
}

/** How many suburb names a postcode's label spells out before "and N more". */
export const LABEL_NAMES = 3;

/** "Bondi, Bondi Beach and 2 more", from every name a postcode covers. */
export function areaLabel(names: readonly string[], andMore: (count: number) => string): string {
  const shown = names.slice(0, LABEL_NAMES).join(", ");
  return names.length > LABEL_NAMES ? `${shown} ${andMore(names.length - LABEL_NAMES)}` : shown;
}
