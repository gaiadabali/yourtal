import { Body, Controller, Inject, InternalServerErrorException, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { UnlockDeviceDto } from "./dto/unlock-device.schema";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { DeviceAuthorize, deviceIdOf } from "./device-authorize";
import { COUNTER_DEVICE_REPOSITORY } from "./persistence/counter-device.repository";
import type { CounterDeviceRepository } from "./persistence/counter-device.repository";
import { MERCHANT_LOCATION_LOOKUP } from "./persistence/merchant-location-lookup";
import type { MerchantLocationLookup } from "./persistence/merchant-location-lookup";
import { unlockDevice } from "./use-cases/unlock-device.use-case";
import { mapDevicesErrorToHttpException } from "./to-http-exception";

/**
 * `POST /api/devices/unlock` (TASKS.md 8.1.a) — the device already
 * authenticated with its bearer credential (`Authorization: Bearer`,
 * resolved by `StoreDevicePrincipalResolver`); this proves the shared PIN
 * on top of that. See `device-authorize.ts`'s header for why this is
 * `@PublicRoute` at the global-guard level rather than `@Authorize`.
 */
@Controller("api/devices")
export class DeviceUnlockController {
  constructor(
    private readonly authorize: DeviceAuthorize,
    @Inject(COUNTER_DEVICE_REPOSITORY) private readonly devices: CounterDeviceRepository,
    @Inject(MERCHANT_LOCATION_LOOKUP) private readonly locations: MerchantLocationLookup,
  ) {}

  // A wrong PIN never moves anything but its own attempt counter; a
  // correct one unlocks a session client-side and moves no server value.
  @NotValueMoving("unlocking a counter session moves no value; failed attempts only tick a counter")
  @RateLimit({ routeId: "devices.unlock", ip: { max: 20, windowSeconds: 15 * 60 } })
  @PublicRoute("device-credential authenticated; the PDP check runs explicitly below")
  @Post("unlock")
  async unlock(@Body() body: UnlockDeviceDto, @Req() request: FastifyRequest) {
    const principal = await this.authorize.requireDevice(
      request,
      () => ({ kind: "device", id: "self" }),
      "unlock",
    );
    const device = await this.devices.findById(deviceIdOf(principal));
    if (device === null) {
      // Unreachable in practice: a valid store_device principal was just
      // resolved from this exact device's own row.
      throw new InternalServerErrorException("device vanished after authentication");
    }
    const result = await unlockDevice(this.devices, device, body.pin, new Date());
    if (result.isErr()) throw mapDevicesErrorToHttpException(result.error);
    // (requested by B, 8.1.a): the counter's only source for its own
    // locale/currency and which physical store it is paired to — there is
    // no session to read either from.
    const locationName = await this.locations.nameOf(device.locationId);
    return {
      unlocked: true as const,
      region: device.region,
      label: device.label,
      locationId: device.locationId,
      locationName: locationName ?? device.locationId,
    };
  }
}
