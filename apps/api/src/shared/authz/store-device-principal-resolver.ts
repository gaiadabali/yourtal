import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { principalSchema } from "@yourtal/authz/principal";
import type { Principal } from "@yourtal/authz/principal";
import { DEVICE_CREDENTIAL_VERIFIER } from "./device-credential-verifier";
import type { DeviceCredentialVerifier } from "./device-credential-verifier";

/**
 * 1.5.c: a `store_device` principal, for the redemption-terminal routes
 * (`policies/resource_policies/redemption.yaml`'s `store_device_of` derived
 * role) — a SEPARATE identity path from `PrincipalService`'s `x-yt-user-id`,
 * because a counter device is not a person and must never be able to claim
 * a business or a location for itself the way a header-trusting principal
 * could. `deviceBusinessId`/`deviceLocationId` come only from
 * `DeviceCredentialVerifier`, which is provisioning-time truth, never the
 * request.
 *
 * Not registered against any route yet: 4.5/6's redemption-terminal
 * controllers are what will call `resolve()`, once they exist. This ticket
 * is the resolver and the port it depends on; wiring a controller to it is
 * that later task's job.
 */
@Injectable()
export class StoreDevicePrincipalResolver {
  constructor(
    @Inject(DEVICE_CREDENTIAL_VERIFIER) private readonly verifier: DeviceCredentialVerifier,
  ) {}

  async resolve(request: FastifyRequest): Promise<Principal> {
    const deviceId = firstHeaderValue(request.headers["x-yt-device-id"]);
    if (deviceId === undefined) {
      throw invalidDeviceCredential();
    }

    const verified = await this.verifier.verify({ deviceId });
    if (verified === null) {
      throw invalidDeviceCredential();
    }

    return principalSchema.parse({
      id: `device:${verified.deviceId}`,
      roles: ["store_device"],
      attr: {
        jurisdiction: verified.jurisdiction,
        businessRoles: {},
        isSuspended: false,
        deviceBusinessId: verified.businessId,
        deviceLocationId: verified.locationId,
      },
    });
  }
}

function invalidDeviceCredential(): UnauthorizedException {
  return new UnauthorizedException({
    code: "invalid_device_credential",
    message: "this device is not provisioned, or its credential is no longer valid",
  });
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
