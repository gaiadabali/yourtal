import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "./principal.service";
import type { SessionValidation, SessionValidator } from "./session-validator";

/** A fake `SessionService.validateAndTouch` — no rows unless seeded (1.5.a). */
function fakeSessions(rows: Record<string, SessionValidation> = {}): SessionValidator {
  return {
    validateAndTouch: (token) =>
      Promise.resolve(rows[token] ?? { valid: false, reason: "not_found" }),
  };
}

function requestWithCookie(cookie: string | undefined): FastifyRequest {
  return { headers: cookie === undefined ? {} : { cookie } } as unknown as FastifyRequest;
}

function requestWithBearer(token: string | undefined): FastifyRequest {
  return {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  } as unknown as FastifyRequest;
}

describe("PrincipalService — 1.5.a: the session, never a header", () => {
  it("resolves an anonymous principal when no credential is presented at all", async () => {
    const service = new PrincipalService(fakeSessions());
    const principal = await service.resolve(requestWithCookie(undefined));
    expect(principal).toMatchObject({ id: "anonymous", roles: ["anonymous"] });
  });

  it("defaults an anonymous principal's jurisdiction to ID", async () => {
    const service = new PrincipalService(fakeSessions());
    const principal = await service.resolve(requestWithCookie(undefined));
    expect(principal.attr.jurisdiction).toBe("ID");
  });

  it("resolves the user id from a valid yt_session cookie", async () => {
    const service = new PrincipalService(
      fakeSessions({ "tok-1": { valid: true, userId: "wina" } }),
    );
    const principal = await service.resolve(requestWithCookie("yt_session=tok-1"));
    expect(principal).toMatchObject({ id: "wina", roles: ["user"] });
  });

  it("reads the cookie among several, and ignores an unrelated one", async () => {
    const service = new PrincipalService(
      fakeSessions({ "tok-1": { valid: true, userId: "wina" } }),
    );
    const principal = await service.resolve(
      requestWithCookie("other=1; yt_session=tok-1; another=2"),
    );
    expect(principal.id).toBe("wina");
  });

  it("resolves the user id from an Authorization: Bearer token, when no cookie is present", async () => {
    const service = new PrincipalService(
      fakeSessions({ "tok-1": { valid: true, userId: "wina" } }),
    );
    const principal = await service.resolve(requestWithBearer("tok-1"));
    expect(principal).toMatchObject({ id: "wina", roles: ["user"] });
  });

  it("prefers the cookie over a Bearer token when both are present", async () => {
    const sessions = fakeSessions({
      "cookie-tok": { valid: true, userId: "cookie-user" },
      "bearer-tok": { valid: true, userId: "bearer-user" },
    });
    const service = new PrincipalService(sessions);
    const request = {
      headers: { cookie: "yt_session=cookie-tok", authorization: "Bearer bearer-tok" },
    } as unknown as FastifyRequest;
    const principal = await service.resolve(request);
    expect(principal.id).toBe("cookie-user");
  });

  it("refuses an unknown token outright, rather than treating it as anonymous", async () => {
    const service = new PrincipalService(fakeSessions());
    await expect(service.resolve(requestWithCookie("yt_session=not-a-real-token"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("refuses a revoked session", async () => {
    const service = new PrincipalService(
      fakeSessions({ "tok-1": { valid: false, reason: "revoked" } }),
    );
    await expect(service.resolve(requestWithCookie("yt_session=tok-1"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("refuses an expired session", async () => {
    const service = new PrincipalService(
      fakeSessions({ "tok-1": { valid: false, reason: "expired" } }),
    );
    await expect(service.resolve(requestWithCookie("yt_session=tok-1"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("touches the session through the real validateAndTouch contract, not a header parse", async () => {
    const validateAndTouch = vi.fn(() => Promise.resolve({ valid: true, userId: "wina" } as const));
    const service = new PrincipalService({ validateAndTouch });
    await service.resolve(requestWithCookie("yt_session=tok-1"));
    expect(validateAndTouch).toHaveBeenCalledWith("tok-1", expect.any(Date));
  });

  it("no longer trusts any x-yt-* header — an anonymous request stays anonymous even with one set", async () => {
    const service = new PrincipalService(fakeSessions());
    const request = {
      headers: { "x-yt-user-id": "someone-i-am-not", "x-yt-business-roles": "{}" },
    } as unknown as FastifyRequest;
    const principal = await service.resolve(request);
    expect(principal.id).toBe("anonymous");
  });
});
