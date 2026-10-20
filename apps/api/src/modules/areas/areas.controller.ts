import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  areaState,
  areaStates,
  postcodeNames,
  postcodeStates,
} from "@yourtal/contracts/areas/data";
import { LABEL_NAMES, isPostcodeShape } from "@yourtal/contracts/areas";
import type { AreaSummary } from "@yourtal/contracts/areas/schema";
import { MAX_AREA_SUMMARIES } from "@yourtal/contracts/areas/schema";
import { regionSchema } from "@yourtal/contracts/region";
import type { Region } from "@yourtal/contracts/region";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";

/** What a postcode looks like to a person: its first suburb names and how many more. */
export function summariseArea(region: Region, postcode: string): AreaSummary {
  const names = postcodeNames(region, postcode);
  return {
    postcode,
    names: names.slice(0, LABEL_NAMES),
    moreCount: Math.max(0, names.length - LABEL_NAMES),
    states: [...postcodeStates(region, postcode)],
  };
}

/**
 * F116: the fixed area list, state then suburb, that Me's "My area" and
 * Studio's district picker read. Public reference data (ABS, CC BY 4.0), so
 * `@PublicRoute`; the region wall is still in code: a signed-in caller gets
 * their own region's list and asking for the other is refused, and an
 * anonymous caller must say which region.
 */
@Controller("api/areas")
export class AreasController {
  constructor(private readonly principals: AsyncPrincipalResolver) {}

  private async regionFor(request: FastifyRequest, queryRegion: unknown): Promise<Region> {
    const parsed = queryRegion === undefined ? undefined : regionSchema.safeParse(queryRegion);
    if (parsed !== undefined && !parsed.success) {
      throw new BadRequestException({ code: "invalid_query", message: "region must be AU or ID" });
    }
    const asked = parsed?.data;
    const principal = await this.principals.resolve(request);
    if (principal.id === "anonymous") {
      if (asked === undefined) {
        throw new BadRequestException({
          code: "region_required",
          message: "an anonymous request must state a region query param",
        });
      }
      return asked;
    }
    const own = principal.attr.jurisdiction;
    if (asked !== undefined && asked !== own) {
      throw new ForbiddenException({
        code: "region_mismatch",
        message: "areas are listed only for your own region",
      });
    }
    return own;
  }

  @PublicRoute("The area list is public reference data; the region wall is enforced in code.")
  @NotValueMoving("A read.")
  @Get()
  async states(@Req() request: FastifyRequest, @Query("region") region?: string) {
    const resolved = await this.regionFor(request, region);
    return {
      region: resolved,
      states: areaStates(resolved).map((state) => ({
        code: state.code,
        name: state.name,
        placeCount: state.places.length,
      })),
    };
  }

  @PublicRoute("The area list is public reference data; the region wall is enforced in code.")
  @NotValueMoving("A read.")
  @Get("states/:code")
  async places(
    @Req() request: FastifyRequest,
    @Param("code") code: string,
    @Query("region") region?: string,
  ) {
    const resolved = await this.regionFor(request, region);
    const state = areaState(resolved, code);
    if (state === undefined) throw new NotFoundException({ code: "area_state_not_found" });
    return {
      region: resolved,
      state: { code: state.code, name: state.name },
      places: state.places,
    };
  }

  /** Several postcodes as people read them, so a saved area or a targeting chip shows suburbs, not digits. */
  @PublicRoute("The area list is public reference data; the region wall is enforced in code.")
  @NotValueMoving("A read.")
  @Get("summaries")
  async summaries(
    @Req() request: FastifyRequest,
    @Query("postcodes") postcodes?: string,
    @Query("region") region?: string,
  ) {
    const resolved = await this.regionFor(request, region);
    const asked = [...new Set((postcodes ?? "").split(",").filter((code) => code.length > 0))];
    if (
      asked.length > MAX_AREA_SUMMARIES ||
      asked.some((code) => !isPostcodeShape(resolved, code))
    ) {
      throw new BadRequestException({
        code: "invalid_query",
        message: `postcodes must be up to ${String(MAX_AREA_SUMMARIES)} comma-separated postcodes`,
      });
    }
    return {
      region: resolved,
      areas: asked
        .filter((code) => postcodeNames(resolved, code).length > 0)
        .map((code) => summariseArea(resolved, code)),
    };
  }
}
