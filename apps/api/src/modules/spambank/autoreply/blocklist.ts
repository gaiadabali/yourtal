import { isIPv4 } from "node:net";
import { Resolver, lookup } from "node:dns/promises";
import type { BlocklistResult } from "@yourtal/contracts/spambank/staff";
import type { Queryable } from "../ingest/db";
import { utcDay } from "./decide";

/**
 * The daily blocklist check (BUILD.md §4.6 "Blocklists", D2 6): Helios's IP in Spamhaus ZEN and SpamCop,
 * the reply and mail domains in the Spamhaus DBL. One `blocklist_check` row per lookup. A `listed` answer
 * pauses the replies; Spamhaus refusing the resolver (`127.255.255.x`, it refuses public resolvers; U14)
 * is `refused`, alerted once a day as "blocklist check not possible".
 */

export type BlocklistList = "zen.spamhaus.org" | "bl.spamcop.net" | "dbl.spamhaus.org";

export type DnsAnswer =
  | { readonly status: "found"; readonly addresses: readonly string[] }
  | { readonly status: "nxdomain" }
  | { readonly status: "error"; readonly detail: string };

export type DnsLookup = (name: string) => Promise<DnsAnswer>;

export interface BlocklistRow {
  readonly target: string;
  readonly list: BlocklistList;
  readonly result: BlocklistResult;
  readonly detail: string | null;
}

/** `187.77.116.133` → `133.116.77.187`. */
export function reversedIp(ip: string): string {
  return ip.split(".").reverse().join(".");
}

function inRange(address: string, prefix: string, low: number, high: number): boolean {
  if (!address.startsWith(prefix)) return false;
  const last = Number(address.slice(prefix.length));
  return Number.isInteger(last) && last >= low && last <= high;
}

/** One answer, read the way each list documents its return codes. */
export function interpret(
  list: BlocklistList,
  answer: DnsAnswer,
): Omit<BlocklistRow, "target" | "list"> {
  if (answer.status === "nxdomain") return { result: "clean", detail: null };
  if (answer.status === "error") return { result: "error", detail: answer.detail.slice(0, 200) };
  const addresses = answer.addresses;
  const detail = addresses.join(",").slice(0, 200);
  if (addresses.some((a) => a.startsWith("127.255.255."))) return { result: "refused", detail };
  const listed =
    list === "zen.spamhaus.org"
      ? addresses.some((a) => inRange(a, "127.0.0.", 2, 11))
      : list === "dbl.spamhaus.org"
        ? addresses.some((a) => a.startsWith("127.0.1."))
        : addresses.includes("127.0.0.2");
  return listed
    ? { result: "listed", detail }
    : { result: "error", detail: `unexpected ${detail}` };
}

function codeOf(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
}

/** No such name (or no A record under it): not listed. */
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA"]);
/** The configured DNS server could not be asked at all: try the OS resolver instead. */
const UNREACHABLE = new Set(["ECONNREFUSED", "ETIMEOUT", "ESERVFAIL", "ECONNRESET"]);

/**
 * Lookups through the host's resolver (whatever Helios uses; U14), 5 seconds each. When the DNS servers
 * Node reads cannot be reached, the OS resolver (getaddrinfo) is asked instead: it follows the same
 * configuration every other program on the host does (systemd-resolved, a local stub).
 */
export function systemDnsLookup(): DnsLookup {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  return async (name) => {
    try {
      return { status: "found", addresses: await resolver.resolve4(name) };
    } catch (error) {
      const code = codeOf(error);
      if (code !== undefined && NOT_FOUND.has(code)) return { status: "nxdomain" };
      if (code === undefined || !UNREACHABLE.has(code)) {
        return { status: "error", detail: code ?? "lookup failed" };
      }
    }
    try {
      const found = await lookup(name, { family: 4, all: true });
      return { status: "found", addresses: found.map((entry) => entry.address) };
    } catch (error) {
      const code = codeOf(error);
      if (code !== undefined && NOT_FOUND.has(code)) return { status: "nxdomain" };
      return { status: "error", detail: code ?? "lookup failed" };
    }
  };
}

export function blocklistQueries(
  ips: readonly string[],
  domains: readonly string[],
): { readonly target: string; readonly list: BlocklistList; readonly name: string }[] {
  const queries: { target: string; list: BlocklistList; name: string }[] = [];
  for (const ip of ips.filter((v) => isIPv4(v))) {
    for (const list of ["zen.spamhaus.org", "bl.spamcop.net"] as const) {
      queries.push({ target: ip, list, name: `${reversedIp(ip)}.${list}` });
    }
  }
  for (const domain of domains) {
    queries.push({ target: domain, list: "dbl.spamhaus.org", name: `${domain}.dbl.spamhaus.org` });
  }
  return queries;
}

export interface BlocklistRun {
  readonly rows: readonly BlocklistRow[];
  readonly listed: readonly BlocklistRow[];
  /** At least one lookup was refused, and none had been refused earlier today. */
  readonly newlyRefused: boolean;
}

export async function runBlocklistCheck(input: {
  readonly db: Queryable;
  readonly lookup: DnsLookup;
  readonly ips: readonly string[];
  readonly domains: readonly string[];
  readonly now: Date;
}): Promise<BlocklistRun> {
  const earlier = await input.db.query<{ n: string }>(
    `SELECT count(*) AS n FROM spambank.blocklist_check
      WHERE result = 'refused' AND (checked_at AT TIME ZONE 'UTC')::date = $1::date`,
    [utcDay(input.now)],
  );
  const rows: BlocklistRow[] = [];
  for (const query of blocklistQueries(input.ips, input.domains)) {
    const row = {
      target: query.target,
      list: query.list,
      ...interpret(query.list, await input.lookup(query.name)),
    };
    rows.push(row);
    await input.db.query(
      `INSERT INTO spambank.blocklist_check (checked_at, target, list, result, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.now, row.target, row.list, row.result, row.detail],
    );
  }
  return {
    rows,
    listed: rows.filter((row) => row.result === "listed"),
    newlyRefused:
      rows.some((row) => row.result === "refused") && Number(earlier.rows[0]?.n ?? "0") === 0,
  };
}
