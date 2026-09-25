import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import type { Resource } from "@yourtal/authz/resources";
import { describe, expect, it } from "vitest";
import { StoreDevicePrincipalResolver } from "./store-device-principal-resolver";
import type {
  DeviceCredentialVerifier,
  VerifiedDeviceCredential,
} from "./device-credential-verifier";

/**
 * 1.5.c, proved against a real Cerbos the same way `principal-freeze.e2e.test.ts`
 * proves YT-0582: `redemption.yaml`'s `store_device_of` derived role needs
 * `P.attr.deviceBusinessId == R.attr.businessId`, so this is the one place
 * that actually checks the resolver's assembled `Principal` is a shape real
 * Cerbos accepts and reasons about correctly — a unit test with a fake
 * verifier (`store-device-principal-resolver.test.ts`) cannot catch a
 * `principal.json`/`resource/redemption.json` schema mismatch the way a
 * real round trip can. No controller calls this resolver yet (that is a
 * later ticket's job), so this drives it directly, the same way the freeze
 * suite drives `AsyncPrincipalResolver` directly with no HTTP layer.
 *
 * Uses THIS worktree's own Cerbos (26335, per `infra/PORTS.md`) rather than
 * the shared 26592: nothing here depends on unmerged policy content, but
 * matching `watch.controller.e2e.test.ts`'s port keeps every 1.5 e2e suite
 * pointed at the same sidecar. Run `docker restart yourtal-cerbos-3` first.
 */
const pdp = createPdpClient({ baseUrl: "http://127.0.0.1:26335" });

function requestWith(deviceId: string): FastifyRequest {
  return { headers: { "x-yt-device-id": deviceId } } as unknown as FastifyRequest;
}

function verifierFor(credential: VerifiedDeviceCredential): DeviceCredentialVerifier {
  return {
    verify: (request) =>
      Promise.resolve(request.deviceId === credential.deviceId ? credential : null),
  };
}

function redemptionAt(businessId: string): Resource<"redemption"> {
  return { kind: "redemption", id: `redemption-${businessId}`, attr: { businessId } };
}

describe("a store_device principal against real Cerbos (1.5.c)", () => {
  it("ALLOWS authorize/capture/lookup at the business its credential names", async () => {
    const resolver = new StoreDevicePrincipalResolver(
      verifierFor({
        deviceId: "device-kemang-2",
        jurisdiction: "ID",
        businessId: "biz-kopi",
        locationId: "loc-kemang",
      }),
    );
    const principal = await resolver.resolve(requestWith("device-kemang-2"));

    for (const action of ["authorize", "capture", "lookup"] as const) {
      const result = await pdp.requireAction(principal, redemptionAt("biz-kopi"), action);
      expect(result.isOk(), `${action} should be allowed`).toBe(true);
    }
  });

  it("DENIES a device at a DIFFERENT business than its own credential names", async () => {
    const resolver = new StoreDevicePrincipalResolver(
      verifierFor({
        deviceId: "device-kemang-2",
        jurisdiction: "ID",
        businessId: "biz-kopi",
        locationId: "loc-kemang",
      }),
    );
    const principal = await resolver.resolve(requestWith("device-kemang-2"));

    const result = await pdp.requireAction(principal, redemptionAt("biz-rival"), "authorize");
    expect(result.isErr()).toBe(true);
  });

  it("DENIES the value-moving-backwards actions explicitly, even at its own business", async () => {
    const resolver = new StoreDevicePrincipalResolver(
      verifierFor({
        deviceId: "device-kemang-2",
        jurisdiction: "ID",
        businessId: "biz-kopi",
        locationId: "loc-kemang",
      }),
    );
    const principal = await resolver.resolve(requestWith("device-kemang-2"));

    const result = await pdp.requireAction(principal, redemptionAt("biz-kopi"), "void");
    expect(result.isErr()).toBe(true);
  });
});
