import { EventEmitter } from "node:events";
import type { request as httpsRequest, RequestOptions } from "node:https";
import { describe, expect, it, vi } from "vitest";
import {
  checkOneClickTarget,
  createOneClickPoster,
  ipv6Words,
  isPublicAddress,
  pinnedLookup,
} from "./ssrf-guard";
import type { Resolver } from "./ssrf-guard";

describe("isPublicAddress (BUILD.md §4.5 SSRF guard)", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "172.17.0.1", // Docker's bridge gateway on Helios
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::10.0.0.1",
    "2002:7f00:1::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "2001:0:4136:e378::1", // Teredo
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "187.77.116.133",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700::6810:84e5",
    "::ffff:8.8.8.8",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("parses IPv6 with an IPv4 tail", () => {
    expect(ipv6Words("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(ipv6Words("1::2::3")).toBeUndefined();
  });
});

const publicResolver: Resolver = () => Promise.resolve([{ address: "93.184.215.14", family: 4 }]);

describe("checkOneClickTarget", () => {
  it.each([
    ["https://127.0.0.1/u", "non-public address"],
    ["https://localhost:18080/u", "port not 443"],
    ["https://localhost/u", "local name"],
    ["https://10.0.0.1/u", "non-public address"],
    ["https://[::1]/u", "non-public address"],
    ["https://[::ffff:127.0.0.1]/u", "non-public address"],
    ["http://lists.example/u", "not https"],
    ["https://lists.example:8443/u", "port not 443"],
    ["https://user:pw@lists.example/u", "credentials in url"],
    ["mailto:x@lists.example", "not https"],
    ["not a url", "not a url"],
  ])("refuses %s (%s)", async (url, reason) => {
    expect(await checkOneClickTarget(url, publicResolver)).toEqual({ ok: false, reason });
  });

  it("refuses a public name that resolves to loopback, and a mixed answer", async () => {
    const loopback: Resolver = () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    expect(await checkOneClickTarget("https://rebind.example/u", loopback)).toEqual({
      ok: false,
      reason: "non-public address",
    });
    const mixed: Resolver = () =>
      Promise.resolve([
        { address: "93.184.215.14", family: 4 },
        { address: "10.1.1.1", family: 4 },
      ]);
    expect((await checkOneClickTarget("https://rebind.example/u", mixed)).ok).toBe(false);
  });

  it("accepts a public name on 443 and pins its address", async () => {
    const target = await checkOneClickTarget("https://lists.example:443/u?id=1", publicResolver);
    expect(target).toMatchObject({ ok: true, address: { address: "93.184.215.14", family: 4 } });
    if (!target.ok) throw new Error("expected ok");
    const lookup = pinnedLookup(target.address);
    const one = vi.fn();
    const all = vi.fn();
    (lookup as unknown as (h: string, o: object, cb: unknown) => void)("other.example", {}, one);
    (lookup as unknown as (h: string, o: object, cb: unknown) => void)(
      "other.example",
      { all: true },
      all,
    );
    expect(one).toHaveBeenCalledWith(null, "93.184.215.14", 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.215.14", family: 4 }]);
  });
});

/** A stand-in for https.request that records calls and answers with `status`. */
function fakeRequest(status: number) {
  const calls: { options: RequestOptions; body: string }[] = [];
  const request = ((options: RequestOptions, onResponse: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(body: string): void; destroy(): void };
    req.destroy = () => undefined;
    req.end = (body: string) => {
      calls.push({ options, body });
      const res = Object.assign(new EventEmitter(), {
        statusCode: status,
        resume: () => undefined,
        destroy: () => undefined,
      });
      queueMicrotask(() => {
        onResponse(res);
      });
    };
    return req;
  }) as unknown as typeof httpsRequest;
  return { request, calls };
}

describe("createOneClickPoster", () => {
  it.each(["https://127.0.0.1/", "https://localhost:18080/", "https://10.0.0.1/"])(
    "makes no connection at all for %s",
    async (url) => {
      const fake = fakeRequest(200);
      const post = createOneClickPoster({ resolve: publicResolver, request: fake.request });
      expect(await post(url)).toMatchObject({ ok: false, status: null });
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("makes no connection for a name resolving to 127.0.0.1", async () => {
    const fake = fakeRequest(200);
    const post = createOneClickPoster({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      request: fake.request,
    });
    expect((await post("https://evil.example/u")).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("POSTs the RFC 8058 body to the checked address, with the name for TLS", async () => {
    const fake = fakeRequest(200);
    const post = createOneClickPoster({ resolve: publicResolver, request: fake.request });
    expect(await post("https://lists.example/unsub?u=1")).toEqual({ ok: true, status: 200 });
    const [call] = fake.calls;
    expect(call?.body).toBe("List-Unsubscribe=One-Click");
    expect(call?.options).toMatchObject({
      method: "POST",
      host: "lists.example",
      port: 443,
      path: "/unsub?u=1",
      agent: false,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(call?.options.headers).not.toHaveProperty("cookie");
  });

  it("treats a 4xx/5xx answer as failed", async () => {
    const post = createOneClickPoster({
      resolve: publicResolver,
      request: fakeRequest(500).request,
    });
    expect(await post("https://lists.example/u")).toMatchObject({ ok: false, status: 500 });
  });
});
