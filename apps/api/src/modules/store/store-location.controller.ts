import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { CreateLocationDto } from "./dto/create-location.schema";
import { EditLocationDto } from "./dto/edit-location.schema";
import { LOCATION_REPOSITORY } from "./persistence/location.repository";
import type { LocationRepository } from "./persistence/location.repository";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import { archiveLocation } from "./use-cases/archive-location.use-case";
import { createLocation } from "./use-cases/create-location.use-case";
import { editLocation } from "./use-cases/edit-location.use-case";
import { getMyLocation } from "./use-cases/get-my-location.use-case";
import { listLocations } from "./use-cases/list-locations.use-case";

/**
 * 7.4.a: a business's own outlets. Reuses the `merchant_location` resource
 * kind (same derived roles as `listing` -- see `policies/resource_policies/
 * merchant_location.yaml`), since branch management is the same Inventory-zone
 * job as listing management, just a different table.
 */
@Controller("api/:tenantId/store/locations")
export class StoreLocationController {
  constructor(@Inject(LOCATION_REPOSITORY) private readonly locations: LocationRepository) {}

  @Authorize({ kind: "merchant_location", action: "create" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post()
  async create(@Param("tenantId") tenantId: string, @Body() body: CreateLocationDto) {
    const result = await createLocation(this.locations, tenantId, body);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "merchant_location", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listLocations(this.locations, tenantId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { locations: result.value };
  }

  @Authorize({ kind: "merchant_location", action: "view" })
  @NotValueMoving("A read.")
  @Get(":locationId")
  async get(@Param("tenantId") tenantId: string, @Param("locationId") locationId: string) {
    const result = await getMyLocation(this.locations, tenantId, locationId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "merchant_location", action: "edit" })
  @NotValueMoving("Name, address and district -- no money or listing linkage.")
  @Patch(":locationId")
  async edit(
    @Param("tenantId") tenantId: string,
    @Param("locationId") locationId: string,
    @Body() body: EditLocationDto,
  ) {
    const result = await editLocation(this.locations, tenantId, locationId, body);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "merchant_location", action: "archive" })
  @NotValueMoving("Removes a branch nothing lists any more; nothing of value moves.")
  @Delete(":locationId")
  async archive(@Param("tenantId") tenantId: string, @Param("locationId") locationId: string) {
    const result = await archiveLocation(this.locations, tenantId, locationId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { archived: true };
  }
}
