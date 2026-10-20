import { HttpException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { assertSameSiteJsonPost, forwardedSessionToken, toHttpException } from "./interaction-http";
import { InteractionError } from "./interaction.service";

const WEB = "https://yourtal.gaiada.com";

function request(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function statusOf(run: () => void): number | "ok" {
  try {
    run();
    return "ok";
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : -1;
  }
}

describe("the interaction POSTs are CSRF-safe", () => {
  const json = { "content-type": "application/json" };

  it("accept a server-to-server JSON call, which sends no Origin", () => {
    expect(statusOf(() => assertSameSiteJsonPost(request(json), WEB))).toBe("ok");
  });

  it("accept YourTal's own origin", () => {
    const headers = { ...json, origin: WEB, "sec-fetch-site": "same-origin" };
    expect(statusOf(() => assertSameSiteJsonPost(request(headers), WEB))).toBe("ok");
  });

  it("refuse another origin, and a cross-site fetch", () => {
    expect(
      statusOf(() =>
        assertSameSiteJsonPost(request({ ...json, origin: "https://evil.example" }), WEB),
      ),
    ).toBe(403);
    expect(
      statusOf(() =>
        assertSameSiteJsonPost(request({ ...json, "sec-fetch-site": "cross-site" }), WEB),
      ),
    ).toBe(403);
    expect(
      statusOf(() =>
        assertSameSiteJsonPost(request({ ...json, "sec-fetch-site": "same-site" }), WEB),
      ),
    ).toBe(403);
  });

  it("refuse anything an HTML form can send", () => {
    for (const type of ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]) {
      expect(statusOf(() => assertSameSiteJsonPost(request({ "content-type": type }), WEB))).toBe(
        415,
      );
    }
    expect(statusOf(() => assertSameSiteJsonPost(request({}), WEB))).toBe(415);
  });
});

describe("the forwarded YourTal session", () => {
  it("is the Bearer token, else the yt_session cookie", () => {
    expect(
      forwardedSessionToken(request({ authorization: "Bearer tok-1", cookie: "yt_session=tok-2" })),
    ).toBe("tok-1");
    expect(
      forwardedSessionToken(
        request({ cookie: "_interaction=u; yt_session=tok-2; _interaction.sig=s" }),
      ),
    ).toBe("tok-2");
    expect(forwardedSessionToken(request({ cookie: "_interaction=u" }))).toBe("");
  });
});

describe("interaction errors", () => {
  it.each([
    ["interaction_not_found", 404],
    ["session_required", 401],
    ["screen_changed", 409],
    ["sign_in_refused", 403],
  ] as const)("%s answers %i with its code", (code, status) => {
    const mapped = toHttpException(new InteractionError(code, "teen_not_allowed"));
    expect(mapped).toBeInstanceOf(HttpException);
    expect((mapped as HttpException).getStatus()).toBe(status);
    expect((mapped as HttpException).getResponse()).toMatchObject({ code });
  });

  it("a refusal carries its code", () => {
    const mapped = toHttpException(new InteractionError("sign_in_refused", "region_not_supported"));
    expect((mapped as HttpException).getResponse()).toMatchObject({
      refusal: "region_not_supported",
    });
  });
});
