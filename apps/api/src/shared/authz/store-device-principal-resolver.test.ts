import { UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { StoreDevicePrincipalResolver } from "./store-device-principal-resolver";
import { NoDeviceCredentialVerifier } from "./device-credential-verifier";
import type {
  DeviceCredentialVerifier,
  VerifiedDeviceCredential,
} from "./device-credential-verifier";

function requestWith(deviceId?: string): FastifyRequest {
  return {
    headers: deviceId === undefined ? {} : { "x-yt-device-id": deviceId },
  } as unknown as FastifyRequest;
}

describe("StoreDevicePrincipalResolver (1.5.c)", () => {
  it("401s with no device id header at all", async () => {
    const resolver = new StoreDevicePrincipalResolver(new NoDeviceCredentialVerifier());
    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("401s clearly until 8.1.b: NoDeviceCredentialVerifier refuses every credential", async () => {
    const resolver = new StoreDevicePrincipalResolver(new NoDeviceCredentialVerifier());
    const rejection = resolver.resolve(requestWith("device-kemang-2"));
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(rejection).rejects.toMatchObject({
      response: { code: "invalid_device_credential" },
    });
  });

  it("builds a real store_device principal once a verifier confirms the credential", async () => {
    // Proves the resolver's OWN assembly is correct independent of 8.1.b —
    // a verifier is a port, and this is the fake that stands in for a real
    // device-credential store the way any other fake in this repo does.
    const verified: VerifiedDeviceCredential = {
      deviceId: "device-kemang-2",
      jurisdiction: "ID",
      businessId: "biz-kopi",
      locationId: "loc-kemang",
    };
    const verifier: DeviceCredentialVerifier = {
      verify: (credential) =>
        Promise.resolve(credential.deviceId === verified.deviceId ? verified : null),
    };
    const resolver = new StoreDevicePrincipalResolver(verifier);

    const principal = await resolver.resolve(requestWith("device-kemang-2"));
    expect(principal).toStrictEqual({
      id: "device:device-kemang-2",
      roles: ["store_device"],
      attr: {
        jurisdiction: "ID",
        businessRoles: {},
        isSuspended: false,
        deviceBusinessId: "biz-kopi",
        deviceLocationId: "loc-kemang",
      },
    });
  });

  it("401s a device id a verifier does not recognize", async () => {
    const verifier: DeviceCredentialVerifier = { verify: () => Promise.resolve(null) };
    const resolver = new StoreDevicePrincipalResolver(verifier);
    await expect(resolver.resolve(requestWith("stolen-device"))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
