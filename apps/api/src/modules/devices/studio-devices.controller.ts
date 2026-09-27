import { Body, Controller, Get, Inject, Param, Post, Delete, Req } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { CounterDevice } from "@yourtal/contracts/device/counter-device";
import { ProvisionDeviceDto } from "./dto/provision-device.schema";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PROVISION_DEVICE_RETENTION_MS } from "./retention";
import { COUNTER_DEVICE_REPOSITORY } from "./persistence/counter-device.repository";
import type {
  CounterDeviceRepository,
  CounterDeviceRow,
} from "./persistence/counter-device.repository";
import { MERCHANT_LOCATION_LOOKUP } from "./persistence/merchant-location-lookup";
import type { MerchantLocationLookup } from "./persistence/merchant-location-lookup";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../store/persistence/business-region-lookup";
import { provisionDevice } from "./use-cases/provision-device.use-case";
import { listDevices } from "./use-cases/list-devices.use-case";
import { revokeDevice } from "./use-cases/revoke-device.use-case";
import { mapDevicesErrorToHttpException } from "./to-http-exception";

function toView(row: CounterDeviceRow): CounterDevice {
  return {
    id: row.id,
    businessId: row.businessId,
    region: row.region,
    locationId: row.locationId,
    label: row.label,
    state: row.revokedAt !== null ? "revoked" : row.pairedAt !== null ? "paired" : "pending",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    pairedAt: row.pairedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Studio -> Team -> Devices (TASKS.md 8.1.a). Devices are provisioned and
 * revoked from here ONLY — the old `/merchant/devices` prototype revoked
 * with no auth at all; this replaces that trust boundary rather than
 * layering a check onto it.
 */
@Controller("api/:tenantId/studio/devices")
export class StudioDevicesController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(COUNTER_DEVICE_REPOSITORY) private readonly devices: CounterDeviceRepository,
    @Inject(MERCHANT_LOCATION_LOOKUP) private readonly locations: MerchantLocationLookup,
    @Inject(BUSINESS_REGION_LOOKUP) private readonly regions: BusinessRegionLookup,
  ) {}

  @Authorize({ kind: "team", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listDevices(this.devices, tenantId);
    if (result.isErr()) throw mapDevicesErrorToHttpException(result.error);
    return result.value.map(toView);
  }

  @Idempotent({ retentionMs: PROVISION_DEVICE_RETENTION_MS })
  @Authorize({ kind: "team", action: "provision_device" })
  @Post()
  async provision(
    @Param("tenantId") tenantId: string,
    @Body() body: ProvisionDeviceDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    // The business's own region, never the caller's — same rule
    // `PdpGuard`'s own `tenantRegion` lookup follows for the F2 wall.
    const business = await this.regions.findRegionAndCurrency(tenantId);
    if (business === null) {
      throw new NotFoundException({ code: "business_not_found", message: "no such business" });
    }
    const result = await provisionDevice(this.devices, this.locations, {
      businessId: tenantId,
      region: business.region,
      locationId: body.locationId,
      label: body.label,
      pin: body.pin,
      createdBy: principal.id,
    });
    if (result.isErr()) throw mapDevicesErrorToHttpException(result.error);
    return {
      device: toView(result.value.device),
      pairingCode: result.value.pairingCode,
      pairingExpiresAt: result.value.pairingExpiresAt.toISOString(),
    };
  }

  // A device is either revoked or it stays exactly as it was — retrying a
  // lost response reaches the same state, never a second side effect.
  @NotValueMoving("revocation only ever moves a device toward 'revoked'; retrying is a no-op")
  @Authorize({ kind: "team", action: "revoke_device" })
  @Delete(":deviceId")
  async revoke(
    @Param("tenantId") tenantId: string,
    @Param("deviceId") deviceId: string,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await revokeDevice(this.devices, tenantId, deviceId, principal.id);
    if (result.isErr()) throw mapDevicesErrorToHttpException(result.error);
    return { revoked: true as const };
  }
}
