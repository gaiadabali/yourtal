import { describe, expect, it } from "vitest";
import { signServiceRequest } from "./service-signature";

describe("signServiceRequest", () => {
  it("matches the ledger's shared vector (serviceauth_test.go TestSharedVector)", () => {
    expect(
      signServiceRequest({
        secret: "test-only-ledger-service-secret-32b",
        caller: "worker",
        method: "POST",
        pathAndQuery: "/v1/releases/unnotified",
        body: '{"limit":100}',
        unixSeconds: 1_790_000_000,
        nonce: "n-1",
      }),
    ).toBe(
      "t=1790000000,c=worker,n=n-1,v1=00b1d876b40f2a0b6df76f9a84d1c5a5232e2305c8458db7b6d010e2fc117a2b",
    );
  });
});
