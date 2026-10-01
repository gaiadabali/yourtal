import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { TRUSTED_PROXIES } from "./trusted-proxies";

// 13.3.e: a client cannot choose its own address; only a loopback hop can say whose request it is.
describe("the api's view of the client address", () => {
  const app = Fastify({ trustProxy: [...TRUSTED_PROXIES] });
  app.get("/ip", (request) => ({ ip: request.ip }));

  async function ipFor(remoteAddress: string, forwarded?: string): Promise<string> {
    const response = await app.inject({
      method: "GET",
      url: "/ip",
      remoteAddress,
      ...(forwarded === undefined ? {} : { headers: { "x-forwarded-for": forwarded } }),
    });
    return response.json<{ ip: string }>().ip;
  }

  it("ignores X-Forwarded-For from a caller that is not a local hop", async () => {
    expect(await ipFor("198.51.100.20", "203.0.113.9")).toBe("198.51.100.20");
  });

  it("believes the address nginx or the web server passes on over loopback", async () => {
    expect(await ipFor("127.0.0.1", "198.51.100.20")).toBe("198.51.100.20");
  });

  it("takes the address the local hop added, not one a client prepended", async () => {
    expect(await ipFor("127.0.0.1", "203.0.113.9, 198.51.100.20")).toBe("198.51.100.20");
  });
});
