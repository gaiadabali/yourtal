#!/usr/bin/env node
// Rebuilds packages/contracts/data/areas/au.json (F116, group 1.6.f).
//
//   node packages/contracts/scripts/build-areas.mjs [--poa file.xlsx --sal file.xlsx]
//
// Source: the ABS ASGS Edition 3 (2021) allocation files for Suburbs and
// Localities (SAL) and Postal Areas (POA). Both assign every Mesh Block to
// one SAL and one POA, so joining on the Mesh Block gives which postcodes
// each suburb covers, weighted by area. CC BY 4.0, (c) Commonwealth of
// Australia (Australian Bureau of Statistics). See data/areas/NOTICE.md.
//
// A suburb is listed under a postcode when that postcode covers at least
// MIN_SHARE of the suburb's area, and every postcode is listed at least
// once (under the suburb it overlaps most), so the list reaches all of
// Australia. No dependencies: the xlsx is read with node:zlib.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/allocation-files";
const POA_URL = `${BASE}/POA_2021_AUST.xlsx`;
const SAL_URL = `${BASE}/SAL_2021_AUST.xlsx`;
const MIN_SHARE = 0.1;

const STATES = {
  1: ["NSW", "New South Wales"],
  2: ["VIC", "Victoria"],
  3: ["QLD", "Queensland"],
  4: ["SA", "South Australia"],
  5: ["WA", "Western Australia"],
  6: ["TAS", "Tasmania"],
  7: ["NT", "Northern Territory"],
  8: ["ACT", "Australian Capital Territory"],
  9: ["OT", "Other Territories"],
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../data/areas/au.json");

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function load(url, localPath) {
  if (localPath !== undefined) return readFileSync(localPath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The named entries of a zip, read from its central directory. */
function unzip(buffer, wanted) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const found = new Map();
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    if (wanted.includes(name)) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const raw = buffer.subarray(start, start + compressed);
      found.set(name, method === 0 ? raw : inflateRawSync(raw));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

const unescapeXml = (text) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Rows of the first sheet as arrays of strings, keyed by column letter order. */
function readSheet(xlsx, onRow) {
  const files = unzip(xlsx, ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]);
  const shared = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const item of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const part of item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += part[1];
    shared.push(unescapeXml(text));
  }
  const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8");
  if (sheet === undefined) throw new Error("sheet1.xml missing");
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = cell[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const body = cell[3] ?? "";
      const value =
        /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
      cells[column] = / t="s"/.test(cell[2]) ? (shared[Number(value)] ?? "") : unescapeXml(value);
    }
    onRow(cells);
  }
}

function columns(header, names) {
  return names.map((name) => {
    const at = header.indexOf(name);
    if (at === -1) throw new Error(`column ${name} missing; found ${header.join(",")}`);
    return at;
  });
}

const poaBuffer = await load(POA_URL, arg("poa"));
const salBuffer = await load(SAL_URL, arg("sal"));
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

// Mesh Block -> [postcode, area]
const poaOf = new Map();
{
  let at;
  readSheet(poaBuffer, (cells) => {
    if (at === undefined) {
      at = columns(cells, ["MB_CODE_2021", "POA_CODE_2021", "AREA_ALBERS_SQKM"]);
      return;
    }
    poaOf.set(cells[at[0]], [cells[at[1]], Number(cells[at[2]])]);
  });
}

// SAL code -> { name, state, postcodes: Map<postcode, area> }
const suburbs = new Map();
{
  let at;
  readSheet(salBuffer, (cells) => {
    if (at === undefined) {
      at = columns(cells, ["MB_CODE_2021", "SAL_CODE_2021", "SAL_NAME_2021", "STATE_CODE_2021"]);
      return;
    }
    const poa = poaOf.get(cells[at[0]]);
    if (poa === undefined || !/^\d{4}$/.test(poa[0])) return;
    const name = cells[at[2]];
    // Not places: a mesh block with no usual address, or at sea.
    if (/^(Migratory|No usual address|Outside Australia)/i.test(name)) return;
    const state = STATES[cells[at[3]]];
    if (state === undefined) return;
    let suburb = suburbs.get(cells[at[1]]);
    if (suburb === undefined) {
      suburb = {
        // "Bondi (NSW)" -> "Bondi": the list is grouped by state already.
        name: name.replace(/\s+\((NSW|Vic\.|Qld|SA|WA|Tas\.|NT|ACT)\)$/, ""),
        state: state[0],
        postcodes: new Map(),
      };
      suburbs.set(cells[at[1]], suburb);
    }
    suburb.postcodes.set(poa[0], (suburb.postcodes.get(poa[0]) ?? 0) + poa[1]);
  });
}

const places = new Map(); // `${state}|${name}|${postcode}` -> [state, name, postcode]
const covered = new Set();
const bestForPostcode = new Map(); // postcode -> { area, suburb }
for (const suburb of suburbs.values()) {
  const total = [...suburb.postcodes.values()].reduce((sum, area) => sum + area, 0);
  for (const [postcode, area] of suburb.postcodes) {
    const best = bestForPostcode.get(postcode);
    if (best === undefined || area > best.area) bestForPostcode.set(postcode, { area, suburb });
    if (total > 0 && area / total >= MIN_SHARE) {
      places.set(`${suburb.state}|${suburb.name}|${postcode}`, [
        suburb.state,
        suburb.name,
        postcode,
      ]);
      covered.add(postcode);
    }
  }
}
for (const [postcode, { suburb }] of bestForPostcode) {
  if (covered.has(postcode)) continue;
  places.set(`${suburb.state}|${suburb.name}|${postcode}`, [suburb.state, suburb.name, postcode]);
}

const byName = (a, b) => a.localeCompare(b, "en-AU");
const states = Object.values(STATES).map(([code, name]) => ({
  code,
  name,
  places: [...places.values()]
    .filter(([state]) => state === code)
    .sort((a, b) => byName(a[1], b[1]) || a[2].localeCompare(b[2]))
    .map(([, suburb, postcode]) => [suburb, postcode]),
}));

const lines = states
  .filter((state) => state.places.length > 0)
  .map(
    (state) =>
      `    {\n      "code": ${JSON.stringify(state.code)},\n      "name": ${JSON.stringify(state.name)},\n      "places": [\n${state.places
        .map((place) => `        ${JSON.stringify(place)}`)
        .join(",\n")}\n      ]\n    }`,
  );
const header = {
  region: "AU",
  kind: "postcode",
  source: "ABS ASGS Edition 3 (2021): SAL and POA allocation files, joined on Mesh Block",
  licence: "CC BY 4.0",
  attribution:
    "Based on Australian Bureau of Statistics data, (c) Commonwealth of Australia, licensed CC BY 4.0",
  sourceSha256: { SAL_2021_AUST: sha(salBuffer), POA_2021_AUST: sha(poaBuffer) },
  minShare: MIN_SHARE,
};
const json = `{\n${Object.entries(header)
  .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  .join(",\n")},\n  "states": [\n${lines.join(",\n")}\n  ]\n}\n`;

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, json);
const postcodes = new Set([...places.values()].map(([, , postcode]) => postcode));
console.log(
  `${outFile}: ${String(places.size)} places, ${String(postcodes.size)} postcodes, ${String(bestForPostcode.size)} postcodes in the ABS data`,
);
