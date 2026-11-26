import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { logger } from "../proxy/http";

/**
 * The RFC 8058 one-click POST (spambank/BUILD.md §4.5), sent from Helios to a URL a marketer wrote.
 * Everything here is about never letting that URL reach something only Helios can reach: https on
 * 443 only, every resolved address public, and the connection made to the address that was checked
 * (the lookup is pinned, so a second DNS answer cannot swap in 127.0.0.1). The certificate is still
 * checked against the name, with SNI.
 */

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface OneClickResult {
  readonly ok: boolean;
  /** The HTTP status, when the request was made. */
  readonly status: number | null;
  /** Why it was refused or failed; for logs, never shown to a person. */
  readonly reason?: string;
}

export type OneClickPoster = (url: string) => Promise<OneClickResult>;

const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";
const TIMEOUT_MS = 10_000;
const MAX_URL = 2048;

function v4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value;
}

/** [network, prefix length] blocks no public request may reach. */
const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // RFC 1918, Docker's networks
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function inV4Block(value: number, network: string, bits: number): boolean {
  const base = v4ToInt(network) ?? 0;
  const size = 2 ** (32 - bits);
  return value >= base && value < base + size;
}

export function isPublicV4(address: string): boolean {
  const value = v4ToInt(address);
  if (value === undefined) return false;
  return !V4_BLOCKED.some(([network, bits]) => inV4Block(value, network, bits));
}

/** The eight 16-bit words of an IPv6 address (with an optional dotted IPv4 tail), or undefined. */
export function ipv6Words(address: string): number[] | undefined {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(":");
  if (lastColon === -1) return undefined;
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    // A dotted IPv4 tail is two words.
    const v4 = v4ToInt(last);
    if (v4 === undefined) return undefined;
    const high = Math.floor(v4 / 65536).toString(16);
    const low = (v4 % 65536).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === "") return [];
    const out: number[] = [];
    for (const word of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(word)) return undefined;
      out.push(Number.parseInt(word, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === undefined || rest === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return undefined;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function embeddedV4(high: number, low: number): string {
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function isPublicV6(address: string): boolean {
  const w = ipv6Words(address);
  if (w === undefined) return false;
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0] = w;
  // ::/96 covers ::, ::1 and the deprecated IPv4-compatible form.
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) return false;
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): judge the IPv4 address inside.
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
    return isPublicV4(embeddedV4(w6, w7));
  }
  if (w0 === 0x64 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    return isPublicV4(embeddedV4(w6, w7));
  }
  if (w0 === 0x2002) return isPublicV4(embeddedV4(w1, w2)); // 6to4
  if (w0 === 0x2001 && w1 === 0) return false; // Teredo hides its IPv4 target
  if (w0 === 0x2001 && w1 === 0x0db8) return false; // documentation
  if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return false; // discard-only
  if ((w0 & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((w0 & 0xffc0) === 0xfe80 || (w0 & 0xffc0) === 0xfec0) return false; // link/site-local
  if ((w0 & 0xff00) === 0xff00) return false; // multicast
  return true;
}

/** True for an address any internet client could reach; false for anything private or special. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

export const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.flatMap((a) =>
    a.family === 4 || a.family === 6 ? [{ address: a.address, family: a.family }] : [],
  );
};

export type CheckedTarget =
  | { readonly ok: true; readonly url: URL; readonly address: ResolvedAddress }
  | { readonly ok: false; readonly reason: string };

/** §4.5's guard, before any connection: https, port 443, no credentials, every address public. */
export async function checkOneClickTarget(raw: string, resolve: Resolver): Promise<CheckedTarget> {
  if (raw.length > MAX_URL) return { ok: false, reason: "url too long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not https" };
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "port not 443" };
  if (url.username !== "" || url.password !== "")
    return { ok: false, reason: "credentials in url" };
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (
    host === "" ||
    host.toLowerCase() === "localhost" ||
    host.toLowerCase().endsWith(".localhost")
  ) {
    return { ok: false, reason: "local name" };
  }
  let addresses: readonly ResolvedAddress[];
  if (isIP(host) !== 0) {
    addresses = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      return { ok: false, reason: "does not resolve" };
    }
  }
  const first = addresses[0];
  if (first === undefined) return { ok: false, reason: "does not resolve" };
  // Every answer, not just the first: a mixed answer is how a rebinding attack starts.
  if (!addresses.every((a) => isPublicAddress(a.address)))
    return { ok: false, reason: "non-public address" };
  return { ok: true, url, address: first };
}

/** A `lookup` that only ever answers the address that was checked. */
export function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (options.all === true)
      callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  }) as LookupFunction;
}

export interface OneClickOptions {
  readonly resolve?: Resolver;
  readonly request?: typeof httpsRequest;
  readonly timeoutMs?: number;
}

export function createOneClickPoster(options: OneClickOptions = {}): OneClickPoster {
  const resolve = options.resolve ?? systemResolver;
  const send = options.request ?? httpsRequest;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return async (raw) => {
    const target = await checkOneClickTarget(raw, resolve);
    if (!target.ok) {
      logger.warn(`one-click unsubscribe refused before connecting: ${target.reason}`);
      return { ok: false, status: null, reason: target.reason };
    }
    const { url, address } = target;
    const requestOptions: RequestOptions = {
      method: "POST",
      host: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      lookup: pinnedLookup(address),
      agent: false,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(Buffer.byteLength(ONE_CLICK_BODY)),
        "user-agent": "YourTal-Spambank/1 (one-click unsubscribe)",
      },
      timeout: timeoutMs,
    };
    return new Promise<OneClickResult>((resolveResult) => {
      let settled = false;
      const done = (result: OneClickResult): void => {
        if (settled) return;
        settled = true;
        resolveResult(result);
      };
      const req = send(requestOptions, (res) => {
        const status = res.statusCode ?? 0;
        // Redirects are not followed (RFC 8058): the POST was received, which is what counts.
        res.resume();
        res.destroy();
        done({
          ok: status >= 200 && status < 400,
          status,
          ...(status >= 400 ? { reason: "http error" } : {}),
        });
      });
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.on("error", () => {
        done({ ok: false, status: null, reason: "connection failed" });
      });
      req.end(ONE_CLICK_BODY);
    });
  };
}
