# Area lists (postcode and suburb)

`au.json` and `id.json` are the fixed list of districts that viewers pick as "my area" in Me and that Studio targets campaigns at (F116). A district is a **postcode**; the suburb names are only how people find it.

## au.json: all of Australia

- **Source:** the Australian Bureau of Statistics (ABS), Australian Statistical Geography Standard (ASGS) Edition 3 (July 2021 to June 2026), allocation files `SAL_2021_AUST.xlsx` (Suburbs and Localities) and `POA_2021_AUST.xlsx` (Postal Areas). Each file assigns every Mesh Block to one SAL and one POA, so joining them on the Mesh Block says which postcodes a suburb covers. Both are on abs.gov.au under Access and downloads > Allocation files.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0). Attribution: "Based on Australian Bureau of Statistics data, (c) Commonwealth of Australia, licensed CC BY 4.0." This list uses no Australia Post data.
- **Why not a GitHub list:** the popular community postcode list `matthewproctor/australianpostcodes` has no licence file (its `LICENSE` is a 404, checked 2026-10-20) and describes its rows as collated from many sources after Australia Post stopped publishing its list free, so its provenance and right to redistribute cannot be shown. It was rejected.
- **Rule:** a suburb is listed under a postcode when that postcode covers at least 10% of the suburb's area, and every postcode is listed at least once (under the suburb it overlaps most). "No usual address" and "Migratory" areas are left out. Area is not population, so a suburb can show a postcode that few of its people use; that costs a campaign a little reach and never shows it to the wrong region.
- **Rebuild:** `pnpm --filter @yourtal/contracts areas:build` downloads both files and rewrites `au.json`; pass `--poa` and `--sal` with local copies to run offline. The SHA-256 of both inputs is written into the file.

## id.json: demo only

Indonesia is a demo (F104). The list is a small hand-written set of well-known cities and districts, each with one representative kode pos. It is public facts written for this repository. Replace it with the BPS or Pos Indonesia list before Indonesia goes live.
