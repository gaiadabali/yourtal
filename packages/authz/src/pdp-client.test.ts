import { describe, expect, it, vi } from "vitest";
import { createPdpClient } from "./pdp-client";
import { anonymousPrincipal } from "./principal";
import type { Principal } from "./principal";
import type { Resource } from "./resources";

/**
 * These tests are mostly about the unhappy paths, because the unhappy paths
 * are where an authorization layer gets dangerous. docs/14 section 8 (A10):
 * a Cerbos timeout must never fall through to "grant". Every failure below
 * asserts that the outcome is an Err the caller has to handle — never an
 * accidental allow, and never a deny that hides a broken contract.
 */

const budi: Principal = {
  id: "budi",
  roles: ["business_user"],
  attr: { jurisdiction: "ID", businessRoles: { "biz-kopi": "owner" }, isSuspended: false },
};

const campaign: Resource<"campaign"> = {
  kind: "campaign",
  id: "camp-1",
  attr: { businessId: "biz-kopi" },
};

function respondWith(body: string, status = 200): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(body, { status })));
}

function stubFetch(effect: string): typeof fetch {
  return respondWith(
    JSON.stringify({
      results: [{ resource: { kind: "campaign", id: "camp-1" }, actions: { view: effect } }],
    }),
  );
}

function clientWith(fetchImpl: typeof fetch) {
  return createPdpClient({ baseUrl: "http://127.0.0.1:3592", fetchImpl });
}

describe("checkResource", () => {
  it("reads EFFECT_ALLOW as allowed", async () => {
    const result = await clientWith(stubFetch("EFFECT_ALLOW")).checkResource(budi, campaign, [
      "view",
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ view: true });
  });

  it.each(["EFFECT_DENY", "EFFECT_NO_MATCH"])("reads %s as not allowed", async (effect) => {
    // EFFECT_NO_MATCH is deny-by-default: no rule matched. It is a deny, not
    // an error — most of this repo's denies arrive that way, because tenant
    // isolation is expressed as "no derived role matches" rather than as a
    // rule someone had to remember to write.
    const result = await clientWith(stubFetch(effect)).checkResource(budi, campaign, ["view"]);
    expect(result._unsafeUnwrap()).toEqual({ view: false });
  });

  it("posts to the Cerbos check endpoint with the principal and the resource", async () => {
    const fetchImpl = stubFetch("EFFECT_ALLOW");
    // The decision is incidental here — this test asserts on what was POSTed.
    // But yt/must-use-result flagged discarding it, and checking it is both
    // cheaper than an escape hatch and a better test: if the call errored,
    // the request assertions below would be inspecting a request that was
    // never really made.
    expect((await clientWith(fetchImpl).checkResource(budi, campaign, ["view"])).isOk()).toBe(true);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3592/api/check/resources");

    const body = JSON.parse(init.body as string);
    expect(body.principal).toEqual(budi);
    expect(body.resources[0].resource).toEqual(campaign);
    expect(body.resources[0].actions).toEqual(["view"]);
  });

  it("asks about several actions in one round trip", async () => {
    const fetchImpl = respondWith(
      JSON.stringify({
        results: [
          {
            resource: { kind: "campaign", id: "camp-1" },
            actions: { view: "EFFECT_ALLOW", publish: "EFFECT_DENY" },
          },
        ],
      }),
    );

    const result = await clientWith(fetchImpl).checkResource(budi, campaign, ["view", "publish"]);
    expect(result._unsafeUnwrap()).toEqual({ view: true, publish: false });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledOnce();
  });
});

describe("failing closed", () => {
  it("an unreachable PDP is not an allow", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).requireAction(budi, campaign, "view");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("pdp_unavailable");
  });

  it("a timeout is not an allow", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new DOMException("The operation was aborted.", "TimeoutError")),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).requireAction(budi, campaign, "view");
    expect(result._unsafeUnwrapErr().type).toBe("pdp_unavailable");
  });

  it("an HTTP 500 from the PDP is not an allow", async () => {
    const result = await clientWith(respondWith("upstream exploded", 500)).requireAction(
      budi,
      campaign,
      "view",
    );
    expect(result._unsafeUnwrapErr()).toEqual({
      type: "pdp_unavailable",
      cause: "PDP returned HTTP 500",
    });
  });

  it("a body that is not JSON is a protocol error", async () => {
    const result = await clientWith(respondWith("<html>gateway</html>")).requireAction(
      budi,
      campaign,
      "view",
    );
    expect(result._unsafeUnwrapErr().type).toBe("pdp_protocol_error");
  });

  it("a response shape this client does not recognise is a protocol error", async () => {
    const result = await clientWith(respondWith(JSON.stringify({ verdict: "yes" }))).requireAction(
      budi,
      campaign,
      "view",
    );
    expect(result._unsafeUnwrapErr().type).toBe("pdp_protocol_error");
  });

  it("an unanswered action is a protocol error, NOT a silent deny", async () => {
    // "Absent means deny" reads as the safe default and is not: it hides the
    // case where this client and the policy repo disagree about which actions
    // exist, which is the drift policy-drift.test.ts exists to catch.
    const fetchImpl = respondWith(
      JSON.stringify({
        results: [{ resource: { kind: "campaign", id: "camp-1" }, actions: {} }],
      }),
    );

    const result = await clientWith(fetchImpl).requireAction(budi, campaign, "view");
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("pdp_protocol_error");
    expect(error).toMatchObject({ cause: expect.stringContaining("did not answer for action") });
  });

  it("an answer about a different resource is a protocol error", async () => {
    const fetchImpl = respondWith(
      JSON.stringify({
        results: [
          {
            resource: { kind: "campaign", id: "someone-else" },
            actions: { view: "EFFECT_ALLOW" },
          },
        ],
      }),
    );

    const result = await clientWith(fetchImpl).requireAction(budi, campaign, "view");
    expect(result._unsafeUnwrapErr().type).toBe("pdp_protocol_error");
  });

  it("checking nothing is a mistake, not a vacuous allow", async () => {
    const result = await clientWith(stubFetch("EFFECT_ALLOW")).checkResource(budi, campaign, []);
    expect(result._unsafeUnwrapErr().type).toBe("pdp_protocol_error");
  });
});

describe("requireAction", () => {
  it("names what was refused so the audit log need not re-derive it", async () => {
    const result = await clientWith(stubFetch("EFFECT_DENY")).requireAction(budi, campaign, "view");
    expect(result._unsafeUnwrapErr()).toEqual({
      type: "forbidden",
      kind: "campaign",
      resourceId: "camp-1",
      action: "view",
    });
  });

  it("an anonymous principal is an ordinary principal to this client", async () => {
    // docs/17 section 4.6 lists what an anonymous visitor cannot do. None of
    // it is enforced here — it is enforced in the policy repo, and this
    // client carries no special case for it. That is the point: one place
    // decides, and it is not this file.
    const fetchImpl = stubFetch("EFFECT_DENY");
    const result = await clientWith(fetchImpl).requireAction(
      anonymousPrincipal("ID"),
      campaign,
      "view",
    );

    expect(result._unsafeUnwrapErr().type).toBe("forbidden");
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).principal.roles).toEqual(["anonymous"]);
  });
});
