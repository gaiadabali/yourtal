import type { Region } from "../region/region";
import auAreas from "../../data/areas/au.json" with { type: "json" };
import idAreas from "../../data/areas/id.json" with { type: "json" };
import type { AreaPlace, AreaState } from "./area-list";

/**
 * F116: the area list per region, loaded from `data/areas/<region>.json`
 * (provenance and licence in `data/areas/NOTICE.md`, rebuilt by
 * `pnpm --filter @yourtal/contracts areas:build`). Server only: the Australian
 * file is about 480 KB, so a client bundle must never import this; the web
 * app reads it through `GET /api/areas`.
 */
interface RawAreaFile {
  readonly states: readonly {
    readonly code: string;
    readonly name: string;
    readonly places: readonly (readonly string[])[];
  }[];
}

interface Loaded {
  readonly states: readonly AreaState[];
  /** postcode -> the suburb names it covers, sorted. */
  readonly namesByPostcode: ReadonlyMap<string, readonly string[]>;
  /** postcode -> the state codes it falls in. */
  readonly statesByPostcode: ReadonlyMap<string, readonly string[]>;
}

function load(file: RawAreaFile): Loaded {
  const states: AreaState[] = file.states.map((state) => ({
    code: state.code,
    name: state.name,
    places: state.places.map(([name = "", postcode = ""]): AreaPlace => ({ name, postcode })),
  }));
  const names = new Map<string, Set<string>>();
  const codes = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  for (const state of states) {
    for (const place of state.places) {
      add(names, place.postcode, place.name);
      add(codes, place.postcode, state.code);
    }
  }
  const sorted = (sets: Map<string, Set<string>>) =>
    new Map([...sets].map(([key, set]) => [key, [...set].sort((a, b) => a.localeCompare(b))]));
  return { states, namesByPostcode: sorted(names), statesByPostcode: sorted(codes) };
}

const LOADED: Record<Region, Loaded> = {
  AU: load(auAreas),
  ID: load(idAreas),
};

export function areaStates(region: Region): readonly AreaState[] {
  return LOADED[region].states;
}

export function areaState(region: Region, code: string): AreaState | undefined {
  return LOADED[region].states.find((state) => state.code === code);
}

/** True only for a postcode on this region's list: the region wall for areas. */
export function isKnownPostcode(region: Region, postcode: string): boolean {
  return LOADED[region].namesByPostcode.has(postcode);
}

export function postcodeNames(region: Region, postcode: string): readonly string[] {
  return LOADED[region].namesByPostcode.get(postcode) ?? [];
}

export function postcodeStates(region: Region, postcode: string): readonly string[] {
  return LOADED[region].statesByPostcode.get(postcode) ?? [];
}

export function knownPostcodeCount(region: Region): number {
  return LOADED[region].namesByPostcode.size;
}
